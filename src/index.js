// TODO: Introduce isAtomic, openF, closeF?
// TODO: Block children atm == inlines, but what about a block having other children that are blocks?
//       i.e. outlining...
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";

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
      text: blockTexts[i],
      prev: prev,
      parent: root,
      rightDelim: "\n",
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
        start: 0,
        parent: block,
        children: [],
      };
      const second = {
        type: "ref",
        text: match[0],
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
        start: second.start + second.text.length,
        parent: block,
        children: [],
      };
      children = [first, second, third];
    } else {
      children.push({
        type: "text",
        text: block.text,
        value: block.text,
        start: 0,
        parent: block,
        children: [],
      });
    }
    nodes = nodes.concat(children);
    block.children = children;
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

function firstDescendant(node) {
  return node.children.length === 0 ? node : firstDescendant(node.children[0]);
}

function lastDescendant(node) {
  return node.children.length === 0
    ? node
    : lastDescendant(node.children[node.children.length - 1]);
}

function moveLeaf(node, direction) {
  const getDescendant = direction === "prev" ? lastDescendant : firstDescendant;

  // try prev/next
  if (node[direction]) {
    return getDescendant(node[direction]);
  } else {
    // try up
    if (node.parent) {
      // try prev/next
      if (node.parent[direction]) {
        return getDescendant(node.parent[direction]);
      } else {
        // `node`'s parent is first/last sibling
        return null;
      }
    } else {
      // `node` is first/last sibling and root
      return null;
    }
  }
}

function* iterAncestors(node) {
  do {
    yield node;
    node = node.parent;
  } while (node)
}

function getRoot(node) {
  while (node.parent) {
    node = node.parent;
  }
  return node;
}

function getPreviousLeaf(node) {
  if (node.children.length > 0) {
    throw new Error("Called getPreviousLeaf on a non-leaf node");
  }
  return moveLeaf(node, "prev");
}

function getNextLeaf(node) {
  if (node.children.length > 0) {
    throw new Error("Called getNextLeaf on a non-leaf node");
  }
  return moveLeaf(node, "next");
}

function firstLeaf(node) {
  if (node.children.length === 0) {
    return node;
  }
  return firstLeaf(node.children[0]);
}

// TODO: Can we reuse logic between this and updateNodeRendered
function* iterNodeStarts(node, start = 0) {
  yield [node, start];
  start += (node.leftDelim ?? "").length;
  if (node.children.length > 0) {
    for (const n of node.children) {
      start = yield* iterNodeStarts(n, start);
    }
  } else {
    start += node.text.length;
  }
  start += (node.rightDelim ?? "").length;
  return start;
}

function getTextCursor(cursor) {
  return (
    [...iterNodeStarts(getRoot(cursor.node))].find(
      ([node]) => node === cursor.node
    )[1] + cursor.char
  );
}

function atNodeEnd(cursor) {
  return cursor.char < cursor.node.text.length;
}

function atNodeStart(cursor) {
  return cursor.char > 0;
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
    return { ...cursor, char: cursor.char - 1 };
  } else {
    const node = cursor.node;
    const prev = getPreviousLeaf(node);
    if (prev) {
      if (prev.parent !== node.parent) {
        // TODO: Must be a better way to handle this discrepency with text nodes...
        return { ...cursor, node: prev, char: prev.rendered.length };
      } else if (prev.type === "text") {
        return { ...cursor, node: prev, char: prev.rendered.length - 1 };
      } else if (prev.type === "ref") {
        // TODO: What if there isn't a getPreviousLeaf(prev)?
        const prevPrev = getPreviousLeaf(prev);
        return { ...cursor, node: prevPrev, char: prevPrev.rendered.length };
      } else {
        throw new Error("Unknown node type: " + prev.type);
      }
    } else {
      // At the beginning of the first node, do nothing.
      return cursor;
    }
  }
}

function rightChar(cursor) {
  if (atNodeEnd(cursor)) {
    return { ...cursor, char: cursor.char + 1 };
  } else {
    const node = cursor.node;
    const next = getNextLeaf(node);
    if (next) {
      if (next.parent !== node.parent) {
        // TODO: Must be a better way to handle this discrepency...
        return { ...cursor, node: next, char: 0 };
      } else if (next.type === "text") {
        return { ...cursor, node: next, char: 1 };
      } else if (next.type === "ref") {
        // TODO: What if there isn't a getNextLeaf(next)?
        return { ...cursor, node: getNextLeaf(next), char: 0 };
      } else {
        throw new Error("Unknown node type: " + node.type);
      }
    } else {
      // At the end of the last node, do nothing.
      return cursor;
    }
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
  const node = cursor.node;
  if (node.type === "text") {
    if (atNodeEnd(cursor)) {
      // TODO: Avoid mutation
      node.text =
        node.text.slice(0, cursor.char) + node.text.slice(cursor.char + 1);
    } else {
      // End of block
      // TODO: Find youngest parent that is a block?
      // TODO: If it has a `next` and that's a block, joinBlocks
      //       Delete the block, join children, update all the pointers
      // TODO: Probably an efficient way to do this from root based on cursor position and intervals...
      const ancestors = [...iterAncestors(cursor.node)].reverse();
      for (const parent of ancestors) {
        console.log(parent);
        // TODO: How do we figure out whether we're at the end of another node?
        //       Basically, how do we translate the cursor from one node's co-ordinate system to one
        //       if its ancestors?
        //       At this point, might be simpler to start with textCursor and kinda binary search
        //       down the tree to the node(s) we care about...
        //       But let's not do that for now... Let's translateCursor(cursor, node)
        if (node.type === "block") {
        }
      }
      const nextParent = node.parent.next;
      if (nextParent) {
        console.log("Deleting into a block");
      } else {
        console.log("End of file");
        // End of file?
      }
    }
  }
  return cursor;
  // - end of node
  // - end of doc
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
//     } else {
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
//     }
//   }
// }

function updateNodeRendered(node, withDelim = true) {
  let rendered = "";
  if (withDelim) {
    rendered += node.leftDelim ?? "";
  }
  if (node.children.length > 0) {
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
  for (const [n, s] of iterNodeStarts(node)) {
    n.start = s;
  }
}

function renderText(node, cursor) {
  const text = node.rendered;
  const textCursor = getTextCursor(cursor);
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
  if (node.children.length > 0) {
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
    updateNodeRendered(getRoot(cursor.node));

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
      // } else if (key === "Backspace") {
      //   cursor = backspaceChar(cursor);
    } else if (key === "Delete") {
      cursor = deleteChar(cursor);
    } else if (key.length === 1) {
      insertChar(cursor, key);
    } else {
      console.log(key);
    }

    // Update nodes given changes
    const root = getRoot(cursor.node);
    updateNodeRendered(root);
    updateNodeStart(root);

    this.setState({ cursor: cursor });
  }

  render() {
    const cursor = this.state.cursor;
    const root = getRoot(cursor.node);
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
