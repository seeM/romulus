// TODO: Deleting a block should update its refs...
// TODO: Can do proper up/down by going to position relative to second level highest node (block)
//       and mantaining a char hint like with other editors.
// TODO: Can I pull projection(...) one level above insertChar, deleteChar, etc?
// TODO: Introduce isAtomic, openF, closeF?
// TODO: Block children atm == inlines, but what about a block having other children that are blocks?
//       i.e. outlining...
// TODO: Clean up text vs value vs rendered...
// TODO: Refactor to immutable tree cursor
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import { filter, first, last, map } from "lodash-es";

// Some text to play with
// TODO: We can't really deal with empty text nodes yet
const TEXT = "foo: ((17)) text\nbar\nbaz";

const BLOCK_DELIM = "\n";
const BLOCK_REF_PATTERN = /\(\((.*)\)\)/;
let LAST_BLOCK_ID = 0;

function Node(data) {
  LAST_BLOCK_ID++;
  return {
    ...data,
    id: LAST_BLOCK_ID,
  };
}

// TODO: Clean this shit up
function deserialize(text) {
  const r = Node({ type: "root", start: 0 });

  // Parse blocks
  let blocks = [];
  const blockTexts = text.split(BLOCK_DELIM);
  let prev = null;
  for (let i = 0; i < blockTexts.length; i++) {
    const start =
      i === 0
        ? 0
        : blocks[i - 1].start + blockTexts[i - 1].length + BLOCK_DELIM.length;
    const block = Node({
      type: "block",
      start: start,
      prev: prev,
      parent: r,
      rightDelim: "\n",
      text: blockTexts[i],
    });
    blocks.push(block);
    prev = block;
  }

  r.children = blocks;

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
      const first = Node({
        type: "text",
        text: plainText[0],
        value: plainText[0],
        parent: block,
        children: [],
      });
      const second = Node({
        type: "ref",
        value: refBlock,
        start: first.start + first.text.length,
        parent: block,
        children: [],
        leftDelim: "((",
        rightDelim: "))",
      });
      const third = Node({
        type: "text",
        text: plainText[1],
        value: plainText[1],
        parent: block,
        children: [],
      });
      children = [first, second, third];
    } else {
      children.push(
        Node({
          type: "text",
          text: block.text,
          value: block.text,
          parent: block,
          children: [],
        })
      );
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
  return { node: first(leaves(r)), char: 0 };
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
    for (const c of n.children) recurse(c);
  })(node);
  return result;
}

function root(node) {
  return last(ancestors(node));
}

function leftmost(node) {
  return first(node.parents.children);
}

function rightmost(node) {
  return last(node.parents.children);
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

function remove(loc) {
  if (loc.parent)
    loc.parent.children.splice(loc.parent.children.indexOf(loc), 1);
  if (loc.prev) {
    loc.prev.next = loc.next;
    loc.prev = null;
  }
  if (loc.next) {
    loc.next.prev = loc.prev
    loc.next = null;
  };
}

function _insertChildAt(loc, index, node) {
  node.parent = loc;
  loc.children.splice(index, 0, node);
}

function insertLeft(loc, node) {
  if (loc.type === node.type && loc.type === "text") {
    loc.text = loc.value = node.text + loc.text;
    return null;
  }

  // Link with left
  if (loc.prev) {
    node.prev = loc.prev;
    loc.prev.next = node;
  }
  // Link with loc
  loc.prev = node;
  node.next = loc;
  // Link with parent
  if (loc.parent)
    _insertChildAt(
      loc.parent,
      Math.max(0, loc.parent.children.indexOf(loc)),
      node
    );
}

function insertRight(loc, node) {
  // if (loc.type === node.type && loc.type === "text") {
  //   loc.text = loc.value = loc.text + node.text;
  //   return null;
  // }

  console.log("insertRight", loc, node);
  // Link with right
  if (loc.next) {
    node.next = loc.next;
    loc.next.prev = node;
  };
  // Link with loc
  loc.next = node;
  node.prev = loc;
  // Link with parent
  if (loc.parent)
    _insertChildAt(loc.parent, loc.parent.children.indexOf(loc) + 1, node);
}

function insertChild(loc, node) {
  if (loc.children.length) insertLeft(first(loc.children), node);
  else {
    loc.children = [node];
    node.parent = loc;
    node.prev = node.next = null;
  }
}

function appendChild(loc, node) {
  if (loc.children.length) insertRight(last(loc.children), node);
  else {
    loc.children = [node];
    node.parent = loc;
    node.prev = node.next = null;
  }
}

function joinRight(loc) {
  console.log('join', loc.next.type, loc.next.children.slice());
  if (loc.next && loc.type === loc.next.type) {
    if (loc.next.children.length) {
      // const _last = last(loc.children);
      // TODO: Why does this affect children...
      for (const c of loc.next.children.slice()) {
        // console.log(c);
        remove(c);
        appendChild(loc, c);
      }
      // Try to join rightmost child of loc with leftmost child of loc.next
      // e.g. to join two text nodes
      // TODO: Handle in insert node?
      // if (_last) joinRight(_last);
    }
    if (loc.type === "text") loc.value = loc.text = loc.text + loc.next.text;
    remove(loc.next);
  }
}

function splitRight(cursor) {
  // TODO: Make recursive...
  // Split at youngest ancestor that responds
  for (const c of projections(cursor)) {
    if (c.node.type === "block") {
      // Split the current leaf
      // TODO: Don't assume we're on the leaf?
      // TODO: don't assume its text type...
      const right = Node({
        ...cursor.node,
        text: cursor.node.text.slice(cursor.char),
      });
      // TODO: Avoid mutation; add replace method
      cursor.node.text = cursor.node.text.slice(0, cursor.char);
      cursor.node.value = cursor.node.text;
      // insertRight(cursor.node, right);

      const block = Node({
        type: "block",
        rightDelim: "\n",
        children: [],
      });
      // Create a new block with trailing leaves and splitted right
      // Remove trailing leaves from block 1
      const i = c.node.children.indexOf(cursor.node);
      // TODO: Super order dependent, hacky af
      for (const x of [right].concat(c.node.children.slice(i + 1)).reverse()) {
        remove(x);
        insertChild(block, x);
      }
      insertRight(c.node, block);

      return cursor;
    }
  }
}

// ----------------------------------------------------------------------------
// Tree/text cursor
// ----------------------------------------------------------------------------

/**
 * Position of each node (depth-first) given its text, starting at pos in node.
 */
// TODO: This is the same as projections but for descendants
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
        joinRight(c.node);
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

function newline(cursor) {
  cursor = splitRight(cursor);

  // TODO: Can we avoid this?
  updateNodeRendered(root(cursor.node));
  updateNodeStart(root(cursor.node));

  cursor = rightChar(cursor);
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
        {"[" + node.type + "]"}
        {" id: " + node.id}
        {", start: " + node.start}
        {", prev: " + node.prev?.id}
        {", next: " + node.next?.id}
        {renderedChildren}
      </div>
    );
  } else {
    return (
      <div className={"node-" + node.type}>
        {"[" + node.type + "]"}
        {" id: " + node.id}
        {", start: " + node.start}
        {", prev: " + node.prev?.id}
        {", next: " + node.next?.id}
        {", text: " + node.text}
        {", value: " + node.value}
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
    updateNodeRendered(root(cursor.node));
    updateNodeStart(root(cursor.node));

    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  componentDidMount() {
    window.addEventListener("keydown", this.handleKeyDown);
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
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
    } else if (key === "Enter") {
      cursor = newline(cursor);
    } else if (key.length === 1) {
      cursor = insertChar(cursor, key);
    } else {
      console.log(key);
    }

    // Update nodes given changes
    const r = root(cursor.node);
    updateNodeRendered(r);
    updateNodeStart(r);

    this.setState({ cursor: cursor });
  }

  render() {
    const cursor = this.state.cursor;
    const r = root(cursor.node);
    const [text, textCursor] = renderText(r, cursor);
    const struct = renderStructElements(r);
    return (
      <div className="App">
        <div className="Text">{text}</div>
        <div className="Structure">
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
