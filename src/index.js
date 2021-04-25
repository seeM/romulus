// TODO: Fixes to atNode{Start,End} broke something else
// TODO: Introduce isAtomic, openF, closeF?
// TODO: Block children atm == inlines, but what about a block having other children that are blocks?
//       i.e. outlining...
// TODO: Clean up text vs value vs rendered...
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
var _ = require("lodash");

// Some text to play with
// TODO: We can't really deal with empty text nodes yet
const TEXT = "foo: ((17)) text\nbar\nbaz";

const BLOCK_DELIM = "\n";
const BLOCK_REF_PATTERN = /\(\((.*)\)\)/;
let LAST_BLOCK_ID = 0;

// TODO: Clean this shit up
function deserialize(text) {
  const root = { type: "root", start: 0 };

  // Parse blocks
  let blocks = [];
  const blockTexts = text.split(BLOCK_DELIM);
  let prev = null;
  for (let i = 0; i < blockTexts.length; i++) {
    const start =
      i === 0
        ? 0
        : blocks[i - 1].start + blockTexts[i - 1].length + BLOCK_DELIM.length;
    const block = {
      type: "block",
      id: LAST_BLOCK_ID + i,
      start: start,
      prev: prev,
      parent: root,
      rightDelim: "\n",
      text: blockTexts[i],
    };
    blocks.push(block);
    LAST_BLOCK_ID += 1;
    prev = block;
  }

  root.children = blocks;

  // For convenience, each block knows its next block.
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].next = i + 1 === blocks.length ? null : blocks[i + 1];
  }

  const startToBlock = {};
  blocks.map((block) => {
    startToBlock[block.start] = block;
    delete block.start;
    return null;
  });

  // Parse inlines
  let nodes = [];
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    // TODO: Super naive parser
    // Parse block references
    let children = [];
    const match = block.text.match(BLOCK_REF_PATTERN);
    if (match) {
      const refStart = match[1];
      const refBlock = startToBlock[refStart];
      if (refBlock == null) {
        throw new Error("Block has invalid ref: '" + block.text + "'");
      }
      const plainText = block.text.split(match[0]);
      // Node starts are relative to their containing block.
      const first = {
        type: "text",
        text: plainText[0],
        value: plainText[0],
        parent: block,
        children: [],
      };
      const second = {
        type: "ref",
        value: refBlock,
        start: first.start + first.text.length,
        parent: block,
        children: [],
        leftDelim: "((",
        rightDelim: "))",
      };
      const third = {
        type: "text",
        text: plainText[1],
        value: plainText[1],
        parent: block,
        children: [],
      };
      children = [first, second, third];
    } else {
      children.push({
        type: "text",
        text: block.text,
        value: block.text,
        parent: block,
        children: [],
      });
    }
    nodes = nodes.concat(children);
    block.children = children;
    delete block.text;
  }

  blocks.map((block) => {
    // Each node knows its closest siblings
    for (let i = 0; i < block.children.length; i++) {
      block.children[i].prev = i === 0 ? null : block.children[i - 1];
      block.children[i].next =
        i + 1 === block.children.length ? null : block.children[i + 1];
    }
    return null;
  });
  return { node: firstLeaf(root), char: 0 };
}

// ----------------------------------------------------------------------------
// Tree
// ----------------------------------------------------------------------------

function ancestors(node) {
  let result = [];
  do {
    result.push(node);
    node = node.parent;
  } while (node);
  return result;
}

function descendants(node) {
  let result = [];
  (function recurse(n) {
    result.push(n);
    for (const c of n.children) {
      recurse(c);
    }
  })(node);
  return result;
}

function top(node) {
  const a = ancestors(node);
  return a[a.length - 1];
}

function leaves(node) {
  return descendants(node).filter((n) => !n.children.length);
}

function firstLeaf(node) {
  return leaves(node)[0] ?? node;
}

function lastLeaf(node) {
  const l = leaves(node);
  return l[l.length - 1] ?? node;
}

function leftLeaf(node) {
  if (node.prev) {
    return lastLeaf(node.prev);
  } else if (node.parent) {
    return leftLeaf(node.parent);
  } else {
    return null;
  }
}

function rightLeaf(node) {
  if (node.next) {
    return firstLeaf(node.next);
  } else if (node.parent) {
    return rightLeaf(node.parent);
  } else {
    return null;
  }
}

function remove(node) {
  // TODO: Avoid mutation, pretty hard with pointers
  if (node.parent)
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
}

function insertNodesAfter(point, ...nodes) {
  // TODO: Avoid mutation
  if (nodes.length) {
    if (point.next) point.next.prev = nodes[nodes.length - 1];
    point.next = nodes[0];

    if (point.parent) {
      const index = point.parent.indexOf(point);
      point.parent.children.splice(index, 0, ...nodes);
    }
  }
}

function insertChildren(point, ...nodes) {
  if (nodes.length) {
    if (point.children.length) {
      insertNodesAfter(point.children[point.children.length - 1], nodes);
    } else {
      point.children = nodes;
      for (const child of nodes) {
        child.parent = point;
      }
    }
  }
}

function concatNodes(m, n) {
  if (m.type === "block" && n.type === "block") {
    for (const child of n.children) {
      child.parent = m;
    }

    const left = m.children[m.children.length - 1];
    const right = n.children[0];
    const conc = concatNodes(left, right);

    if (conc) {
      if (m.prev) m.prev.next = conc;
      if (n.next) n.next.prev = conc;
      m.children = m.children
        .slice(0, m.children.length - 1)
        .concat(conc)
        .concat(n.children.slice(1));
    } else {
      m.prev = left;
      n.next = right;
      m.children = m.children.concat(n.children);
    }
  } else if (m.type === "text" && n.type === "text") {
    return {
      ...m,
      text: m.text + n.text,
      value: m.text + n.text,
    };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Tree/text cursor
// ----------------------------------------------------------------------------

function positions(node, pos = 0) {
  let result = [];
  (function recurse(n, p) {
    result.push([n, p]);
    p += n.leftDelim?.length ?? 0;
    for (const c of n.children) p = recurse(c, p);
    if (n.text?.length) p += n.text.length;
    p += n.rightDelim?.length ?? 0;
    return p;
  })(node, pos);
  return result;
}

// function joinNodes(node) {
//   const [m, n] = [node, node.next];

//   // If next exists, and has the same type
//   if (n && (m.type === n.type)) {

//     if (m.children.length) {
//       insertNodesAfter(m.children[m.children.length - 1], n.children);
//       remove(n);
//     }

//     // TODO: Extract to simple tree/cursor module -------------------
//     const mLast = m.children[m.children.length - 1];
//     const nFirst = n.children[0];
//     if (mLast && nFirst) {
//       const joined = joinNode(left);
//       if (joined) {
//         remove(n);
//         if (m.prev)
//           m.prev.next = joined;
//         if (n.next)
//           n.next.prev = joined;
//         children = (
//           m.children.slice(0, m.children.length - 1).concat(joined).concat(n.children.slice(1))
//         );
//       } else {
//         m.prev = left;
//         n.next = right;
//         children = m.children.concat(n.children);
//       }
//     }

//     // --------------------------------------------------------------

//     // If they're both text nodes, also merge text
//     if (m.type === "text") {
//       m.text = m.text + n.text;
//       m.value = m.text;
//     }

//     return m;
//   }

//   return null;

// }

// function joinNodes(node) {
//   // TODO: node.next needs to become more complex when we handle nested blocks
//   const [m, n] = [node, node.next];
//   // TODO: Avoid mutation
//   if (n) {

//     if (n.children.length) {
//       for (const child of n.children) {
//         child.parent = m;
//       }

//       const left = m.children[m.children.length - 1];
//       const right = n.children[0];
//       const conc = concatNodes(left, right);
//     }

//     if (m.type === "block" && n.type === "block") {

//       if (conc) {
//         if (m.prev)
//           m.prev.next = conc;
//         if (n.next)
//           n.next.prev = conc;
//         m.children = (
//           m.children.slice(0, m.children.length - 1).concat(conc).concat(n.children.slice(1))
//         );
//       } else {
//         m.prev = left;
//         n.next = right;
//         m.children = m.children.concat(n.children);
//       }
//     } else if (m.type === "text" && n.type === "text") {
//       return {
//         ...m,
//         text: m.text + n.text,
//         value: m.text + n.text,
//       }
//     }
//     concatNodes(node, node.next);
//     remove(node.next);
//   }
// }

function projections(cursor) {
  let result = [];
  do {
    result.push(cursor);
    cursor = {
      node: cursor.node.parent,
      char: cursor.node.start + cursor.char - (cursor.node.parent?.start ?? 0),
    };
  } while (cursor.node);
  return result;
}

function atNodeEnd(cursor) {
  if (cursor.node.type === "text") {
    return cursor.char === cursor.node.rendered.length;
  } else {
    return cursor.char === cursor.node.rendered.length - 1;
  }
}

function atNodeStart(cursor) {
  return cursor.char === 0;
}

// TODO: In reality, up and down would need to move along virtual lines
//       (since blocks may wrap), not blocks. This will be a terrible UX
//       as it is!
function upChar(cursor) {
  // TODO: Treat blocks as arbitrary nodes.
  const prev = cursor.node.parent.prev;
  if (prev) {
    // Not at the first block, move to the previous block.
    // TODO: What if prev has no children?
    return { ...cursor, node: prev.children[0], char: 0 };
  } else {
    // At the first block, do nothing.
    return cursor;
  }
}

function downChar(cursor) {
  // TODO: Treat blocks as arbitrary nodes.
  const next = cursor.node.parent.next;
  if (next) {
    // Not at the last block, move to the next block.
    // TODO: What if next has no children?
    return { ...cursor, node: next.children[0], char: 0 };
  } else {
    // At the last block, do nothing.
    return cursor;
  }
}

function leftChar(cursor) {
  if (atNodeStart(cursor)) {
    const node = cursor.node;
    const prev = leftLeaf(node);
    if (prev) {
      if (prev.parent !== node.parent) {
        // TODO: Must be a better way to handle this discrepency with text nodes...
        return { ...cursor, node: prev, char: prev.rendered.length };
      } else if (prev.type === "text") {
        return { ...cursor, node: prev, char: prev.rendered.length - 1 };
      } else if (prev.type === "ref") {
        // TODO: What if there isn't a leftLeaf(prev)?
        const prevPrev = leftLeaf(prev);
        return { ...cursor, node: prevPrev, char: prevPrev.rendered.length };
      } else {
        throw new Error("Unknown node type: " + prev.type);
      }
    } else {
      // At the beginning of the first node, do nothing.
      return cursor;
    }
  } else {
    return { ...cursor, char: cursor.char - 1 };
  }
}

function rightChar(cursor) {
  if (atNodeEnd(cursor)) {
    const node = cursor.node;
    const next = rightLeaf(node);
    if (next) {
      if (next.parent !== node.parent) {
        // TODO: Must be a better way to handle this discrepency...
        return { ...cursor, node: next, char: 0 };
      } else if (next.type === "text") {
        return { ...cursor, node: next, char: 1 };
      } else if (next.type === "ref") {
        // TODO: What if there isn't a rightLeaf(next)?
        return { ...cursor, node: rightLeaf(next), char: 0 };
      } else {
        throw new Error("Unknown node type: " + node.type);
      }
    } else {
      // At the end of the last node, do nothing.
      return cursor;
    }
  } else {
    return { ...cursor, char: cursor.char + 1 };
  }
}

function insertChar(cursor, chr) {
  // TODO: Avoid mutation
  const node = cursor.node;
  if (node.type === "text") {
    node.text =
      node.text.slice(0, cursor.char) + chr + node.text.slice(cursor.char);
    cursor.char++;
  }
}

function deleteChar(cursor) {
  // Eldest responds first
  let done = false;
  for (cursor of projections(cursor).reverse()) {
    if (done) {
      break;
    }
    const node = cursor.node;

    if (node.type === "root") {
      if (atNodeEnd(cursor)) {
        console.log("End of doc");
      }
    } else if (node.type === "block") {
      if (atNodeEnd(cursor)) {
        if (node.next) {
          // joinNodes(node);
          done = true;
        }
      }
    } else if (node.type === "text") {
      if (!atNodeEnd(cursor)) {
        // TODO: Avoid mutation
        node.text =
          node.text.slice(0, cursor.char) + node.text.slice(cursor.char + 1);
        done = true;
      }
      // TODO: What to do at text end?
    }
  }
}

// function backspaceChar(cursor) {
//   // TODO: This is just leftChar -> deleteChar?
//   const node = cursor.node;
//   // TODO: Block management could exist outside of the interface layer completely...
//   if (node.type === "text") {
//     if (atNodeStart(cursor)) {
//       // TODO: Avoid mutation
//       node.text = node.text.slice(0, cursor.char - 1) + node.text.slice(cursor.char);
//       cursor.char--;
//       // At the beginning of a node
//       if (node.prev && node.prev.parent !== node.parent) {
//         // Backspaced from beginning of a block

//         // Delete the block and update all the pointers
//         const block = node.parent;
//         const blocks = this.state.blocks;
//         // TODO: Updating the pointers is really a shit show maintaining all of this stuff...
//         //       Probably need a tree abstraction somewhere...
//         console.log(block);
//         let newBlock = {
//           ...block.prev,
//           children: block.prev.children.concat(block.children),
//           next: block.next,
//         };
//         // TODO: How to make this immutable?
//         newBlock.children = newBlock.children.map(n => ({...n, parent: newBlock}));

//         // Update nodes list
//         // NOTE: Have to update *all* of this block's nodes because they were recreated above
//         const newNodes1 = newBlock.children;
//         const nodeIndex = nodes.findIndex(n => (n === node));
//         const newNodes = nodes.slice(0, nodeIndex).concat(newNodes1, nodes.slice(nodeIndex + newNodes1.length));
//         // console.log(nodes);
//         // console.log(nodeIndex);
//         // console.log(newNodes1);
//         // console.log(newNodes);
//         // Update cursor
//         // cursor.node = newNode;
//         // console.log(newNode);

//         // TODO: Really need a better way to do this.
//         const blockIndex = blocks.findIndex(b => b === block);
//         const newBlocks = (
//           blocks.slice(0, blockIndex - 1)
//           .concat(
//             newBlock,
//             {
//               ...block.next,
//               prev: block,
//             },
//             blocks.slice(blockIndex + 2),
//           )
//         );
//         // TODO: We just deleted a block... How do we update all refs of it?
//         // TODO: Don't mutate like this. At least move to end of function

//         this.setState({ blocks: newBlocks, nodes: newNodes });

//         console.log(newBlocks);
//       } else {
//         // Backspaced at the beginning of a node, but not beginning of a block
//         if (node.prev.type === "text") {
//           // TODO: Join text nodes?
//         }
//       }
//     } else {
//     }
//   }
// }

function updateNodeRendered(node, withDelim = true) {
  let rendered = "";
  if (withDelim) {
    rendered += node.leftDelim ?? "";
  }
  if (node.children.length) {
    rendered += node.children
      .map((n) => updateNodeRendered(n))
      .reduce((a, b) => a + b, "");
  } else if (node.type === "text") {
    rendered += node.text;
  } else if (node.type === "ref") {
    // TODO: Pay cost of double render here.
    // TODO: Better way than withDelim?
    // TODO: Avoid mutation...
    node.text = updateNodeRendered(node.value, false);
    rendered += node.text;
  }
  if (withDelim) {
    rendered += node.rightDelim ?? "";
  }
  // TODO: Avoid mutation...
  node.rendered = rendered;
  return rendered;
}

function updateNodeStart(node) {
  for (const [n, s] of positions(node)) {
    n.start = s;
  }
}

function renderText(node, cursor) {
  const text = node.rendered;
  const textCursor = _.last(projections(cursor)).char;
  return [
    [
      text.slice(0, textCursor),
      <div className="TextAfter">
        <span className="Cursor"></span>
        {text.slice(textCursor)}
      </div>,
    ],
    textCursor,
  ];
}

function renderStructElements(node) {
  let renderedChildren = [];
  if (node.children.length) {
    renderedChildren = node.children.map(renderStructElements);
  }
  if (node.type === "root" || node.type === "block") {
    return (
      <div className={"node-" + node.type}>
        {"[" + node.type + "]"} {"start: " + node.start}
        {renderedChildren}
      </div>
    );
  } else {
    return (
      <div className={"node-" + node.type}>
        {"[" + node.type + "]"} {"text: " + node.text}{" "}
        {", value: " + node.value} {", start: " + node.start}
      </div>
    );
  }
}

class App extends React.Component {
  constructor(props) {
    super(props);
    const cursor = deserialize(TEXT);
    this.state = {
      cursor: cursor,
    };

    // TODO: Any way to avoid having to do this here as well?
    updateNodeRendered(top(cursor.node));

    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  handleKeyDown(event) {
    let cursor = this.state.cursor;

    const key = event.key;
    if (key === "ArrowUp") {
      cursor = upChar(cursor);
    } else if (key === "ArrowDown") {
      cursor = downChar(cursor);
    } else if (key === "ArrowLeft") {
      cursor = leftChar(cursor);
    } else if (key === "ArrowRight") {
      cursor = rightChar(cursor);
    } else if (key === "Backspace") {
      cursor = leftChar(cursor);
      deleteChar(cursor);
    } else if (key === "Delete") {
      deleteChar(cursor);
    } else if (key.length === 1) {
      insertChar(cursor, key);
    } else {
      console.log(key);
    }

    // Update nodes given changes
    const root = top(cursor.node);
    updateNodeRendered(root);
    updateNodeStart(root);

    this.setState({ cursor: cursor });
  }

  render() {
    const cursor = this.state.cursor;
    const root = top(cursor.node);
    const [text, textCursor] = renderText(root, cursor);
    const struct = renderStructElements(root);
    return (
      <div className="App">
        <div className="Text">{text}</div>
        <div className="Structure" onKeyDown={this.handleKeyDown} tabIndex="0">
          <div>
            {"Text: " + textCursor}
            {"\nStruct: " +
              this.state.cursor.node.text +
              ", " +
              this.state.cursor.char}
          </div>
          {struct}
        </div>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
