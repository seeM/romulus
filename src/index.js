// TODO: Can I pull projection(...) one level above insertChar, deleteChar, etc?
// TODO: Fixes to atNode{Start,End} broke something else
// TODO: Introduce isAtomic, openF, closeF?
// TODO: Block children atm == inlines, but what about a block having other children that are blocks?
//       i.e. outlining...
// TODO: Clean up text vs value vs rendered...
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import { filter, first, last } from "lodash-es";

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
  return { node: first(leaves(root)), char: 0 };
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
  return last(ancestors(node));
}

function leaves(node) {
  return filter(descendants(node), (n) => !n.children.length);
}

function leftLeaf(node) {
  return node.prev
    ? last(leaves(node.prev))
    : node.parent
    ? leftLeaf(node.parent)
    : null;
}

function rightLeaf(node) {
  return node.next
    ? first(leaves(node.next))
    : node.parent
    ? rightLeaf(node.parent)
    : null;
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

/**
 * Position of each node (depth-first) given its text, starting at pos in node.
 */
// TODO: This is a bit dodge... E.g. handles block refs in not an amazing way.
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

/**
 * Project cursor onto its ancestors.
 */
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

// TODO: Need offset?
function start(node) {
  return { node: node, char: 0 };
}

// TODO: Need offset?
function end(node) {
  return { node: node, char: node.rendered.length };
}

// TODO: Should this rather use projections?
function leftChar(cursor) {
  const l = leftLeaf(cursor.node);

  for (const c of projections(cursor).reverse()) {
    if (atNodeStart(c)) {
      if (c.node.type === "root") return cursor;
      if (c.node.type === "block") return end(l);
      if (l.type === "text") {
        // TODO: Need offset?
        // const result = end(l);
        // result.char--;
        // return result;
        return end(l);
      }
      // Skip over refs.
      if (l.type === "ref") return end(leftLeaf(l));
    }
  }

  return { ...cursor, char: cursor.char - 1 };
}

function rightChar(cursor) {
  const r = rightLeaf(cursor.node);

  for (const c of projections(cursor).reverse()) {
    if (atNodeEnd(c)) {
      if (c.node.type === "root") return cursor;
      if (c.node.type === "block") return start(r);
      if (r.type === "text") {
        // TODO: Need offset?
        // const result = end(r);
        // result.char++;
        // return result;
        return start(r);
      }
      // Skip over refs.
      if (r.type === "ref") return start(rightLeaf(r));
    }
  }

  return { ...cursor, char: cursor.char + 1 };
}

function insertChar(cursor, chr) {
  for (const c of projections(cursor).reverse()) {
    if (c.node.type === "text") {
      // TODO: Avoid mutation
      c.node.text =
        c.node.text.slice(0, c.char) + chr + c.node.text.slice(c.char);
      return { ...cursor, char: cursor.char + 1 };
    }
  }
  return cursor;
}

function deleteChar(cursor) {
  for (const c of projections(cursor).reverse()) {
    if (atNodeEnd(c)) {
      if (c.node.type === "root") {
        console.log("End of doc");
        return cursor;
      }
      if (c.node.type === "block") {
        // NEXT
        // joinNodes(c.node);
        return cursor;
      }
    }

    if (c.node.type === "text") {
      // TODO: Avoid mutation
      c.node.text =
        c.node.text.slice(0, c.char) + c.node.text.slice(c.char + 1);
      return cursor;
    }
  }
  return cursor;
}

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
  const textCursor = last(projections(cursor)).char;
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
    updateNodeStart(top(cursor.node));

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
      // TODO: This won't play nice with how leftChar currently skips refs.
      const prev = cursor;
      cursor = leftChar(cursor);
      if (cursor !== prev) cursor = deleteChar(cursor);
    } else if (key === "Delete") {
      cursor = deleteChar(cursor);
    } else if (key.length === 1) {
      cursor = insertChar(cursor, key);
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
