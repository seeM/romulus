// TODO: Refactor cursor to point to actual node not id?
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

function deserialize(text) {
  // TODO: Can I avoid mutating here? Does it matter?

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
    };
    blocks.push(block);
    LAST_BLOCK_ID += 1;
    prev = block;
  }

  // For convenience, each block knows its next block.
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].next = i + 1 === blocks.length ? null : blocks[i + 1];
  }

  // TODO: Functional?
  const startToBlock = {};
  blocks.map((block) => {
    startToBlock[block.start] = block;
    return null;
  });

  // Parse inlines
  let nodes = [];
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    // TODO: This is a super naive parser...
    // Parse block references
    let children = [];
    const match = block.text.match(BLOCK_REF_PATTERN);
    if (match) {
      const refStart = match[1];
      const refBlock = startToBlock[refStart];
      if (refBlock == null) {
        console.log(blocks);
        throw new Error("Block has invalid ref: '" + block.text + "'");
      }
      // TODO: Go from refStart to block? Should we keep a map of refStart -> block?
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

  // For convenience, each node knows its previous and next node.
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].prev = i === 0 ? null : nodes[i - 1];
    nodes[i].next = i + 1 === nodes.length ? null : nodes[i + 1];
  }

  return blocks;
}

function renderStructElements(blocks) {
  // TODO: This is a super naive struct renderer
  return blocks.map((block) => {
    let children = block.children.map((child) => (
      <div className={"node-" + child.type}>
        {"[" + child.type + "]"} {"text: " + child.text}{" "}
        {", value: " + child.value} {", start: " + child.start}
      </div>
    ));
    return (
      <div className={"node-" + block.type}>
        {"[" + block.type + "]"} {"start: " + block.start} {children}
      </div>
    );
  });
}

// function previousNode(nodes, node) {
//   return node.prev;
// }

function firstDescendant(node) {
  return node.children.length === 0
    ? node
    : firstDescendant(_.first(node.children));
}

function lastDescendant(node) {
  return node.children.length === 0
    ? node
    : lastDescendant(_.last(node.children));
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

function previousLeaf(node) {
  if (node.children.length > 0) {
    throw new Error("Called previousLeaf on a non-leaf node");
  }
  return moveLeaf(node, "prev");
}

function nextLeaf(node) {
  if (node.children.length > 0) {
    throw new Error("Called nextLeaf on a non-leaf node");
  }
  return moveLeaf(node, "next");
}

function previousLeaves(node) {
  // TODO: Clean up
  let ret = [];
  let cur = node;
  while (cur) {
    cur = previousLeaf(cur);
    if (cur) {
      ret.push(cur);
    }
  }
  return ret;
}

// function backward(struct, cursor) {
//   return [struct, cursor]
// }

// function get(struct, cursor) {
// }

class App extends React.Component {
  constructor(props) {
    super(props);
    const blocks = deserialize(TEXT);
    this.state = {
      blocks: blocks,
      // TODO: Make this take a path?
      cursor: { node: blocks[0].children[0], char: 0 },
    };
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  handleKeyDown(event) {
    let cursor = this.state.cursor;

    // The cursor moves along nodes, and we easily translate from
    // that to the block and text co-ordinate systems as needed. Nodes know
    // their position in a block, and blocks know their position in the text.

    // TODO: In reality, up and down would need to move along virtual lines
    // (since blocks may wrap), not blocks. This will be a terrible UX as it
    // is!

    const key = event.key;
    if (key === "ArrowUp") {
      const prev = cursor.node.parent.prev;
      if (prev) {
        // Not at the first block, move to the previous block.
        cursor.block = prev;
        cursor.node = prev.children[0];
        cursor.char = 0;
      } else {
        // At the first block, do nothing.
      }
    } else if (key === "ArrowDown") {
      const next = cursor.node.parent.next;
      if (next) {
        // Not at the last block, move to the next block.
        cursor.block = next;
        cursor.node = next.children[0];
        cursor.char = 0;
      } else {
        // At the last block, do nothing.
      }
      // } else if (key === "ArrowLeft") {
      //   if (cursor.char <= 0) {
      //     // At the beginning of a node.
      //     if (cursor.node <= 0) {
      //       // At the beginning of the first node, do nothing.
      //     } else {
      //       // At the beginning of a node.
      //       const node = nodes[cursor.node];
      //       const prev = node.prev;
      //       if (prev.parent !== node.parent) {
      //         // Moved to a new block.
      //         cursor.node--;
      //         cursor.char = prev.rendered.length - 1;
      //       } else if (prev.type === "text") {
      //         // Go to the last char of the previous node.
      //         cursor.node--;
      //         cursor.char = prev.rendered.length - 1;
      //       } else if (prev.type === "ref") {
      //         // Go passed the last char of the 2x previous node.
      //         cursor.node -= 2;
      //         // TODO: What if there's no previous node?
      //         cursor.char = prev.prev.rendered.length;
      //       } else {
      //         throw new Error("Unknown node type: " + prev.type);
      //       }
      //     }
      //   } else {
      //     // Not at the beginning of a node
      //     // Go back one char.
      //     cursor.char--;
      //   }
      // } else if (key === "ArrowRight") {
      //   if (cursor.char >= nodes[cursor.node].text.length) {
      //     // At the end of a node.
      //     if (cursor.node >= nodes.length - 1) {
      //       // At the end of the last node, do nothing.
      //     } else {
      //       // At the end of a node.
      //       const node = nodes[cursor.node].next;
      //       if (node.parent !== nodes[cursor.node].parent) {
      //         // Moved to a new block.
      //         cursor.node++;
      //         cursor.char = 0;
      //       } else if (node.type === "text") {
      //         // Move one char into the next node.
      //         cursor.node++;
      //         cursor.char = 1;
      //       } else if (node.type === "ref") {
      //         // Go forward passed the ref's rendered text.
      //         // TODO: This ain't good because we're contaminating cursor movement with rendering logic.
      //         // I.e. the assumption about how refs are rendered... Need a better way!
      //         // cursor.char += BLOCK_REF_DELIM_LENGTH + node.value.text.length;
      //         cursor.node += 2;
      //         cursor.char = 0;
      //         // TODO: Can't we just move to the next node? And deal with where these nodes are within a block
      //         // only at text render time??? Booyakasha
      //       } else {
      //         throw new Error("Unknown node type: " + node.type);
      //       }
      //     }
      //   } else {
      //     // Not at the end of a node, go forward one char.
      //     cursor.char++;
      //   }
      // } else if (key === "Backspace") {
      //   const node = nodes[cursor.node];
      //   // TODO: Block management could exist outside of the interface layer completely...
      //   if (node.type === "text") {
      //     if (cursor.char <= 0) {
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
      //       // Not at the beginning of a node
      //       node.text = node.text.slice(0, cursor.char - 1) + node.text.slice(cursor.char);
      //       cursor.char--;
      //     }
      //   }
      // } else if (key.length === 1) {
      //   // Text char
      //   const node = nodes[cursor.node];
      //   if (node.type === "text") {
      //     node.text =
      //       node.text.slice(0, cursor.char) +
      //       key +
      //       node.text.slice(cursor.char);
      //     cursor.char++;
      //   }
    } else {
      console.log(key);
    }

    this.setState({ cursor: cursor });
  }

  render() {
    // Serialize blocks to text
    const blocks = this.state.blocks;
    const lines = blocks.map((block) => {
      const nodeTexts = block.children.map((node) => {
        if (node.type === "text") {
          node.rendered = node.text;
          return node.rendered;
        } else if (node.type === "ref") {
          // TODO: If we want text as both interface and persistance layer,
          // how do we ALSO do WYSIWYG in that interface? E.g. replacing ((1))
          // with stylised text of block 1 isn't respecting the persistance
          // layer.
          // In other words, do we render raw text or stylised divs?
          const refBlock = node.value;
          // TODO: Adding brackets because we're rendering raw unstylised text,
          // but we still need some indication that it's a ref. See todo above.
          node.rendered = "((" + refBlock.text + "))";
          return node.rendered;
        } else {
          throw new Error("Unknown node type: " + node.type);
        }
      });
      return nodeTexts.join("");
    });
    const text = lines.join(BLOCK_DELIM);

    // Translate treeCursor to textCursor
    const cursor = this.state.cursor;
    const node = cursor.node;
    const _previousLeaves = previousLeaves(node);
    const nodeCharOffset = _previousLeaves
      .map((n) => n.rendered.length)
      .reduce((a, b) => a + b, 0);
    // TODO: Shitty way to account for newlines
    const block = node.parent;
    const blockIndex = blocks.findIndex((b) => b === block);
    const textCursor = nodeCharOffset + blockIndex + cursor.char;

    // Render text with span at cursor position.
    const textWithCursor = [
      text.slice(0, textCursor),
      <div className="TextAfter">
        <span className="Cursor"></span>
        {text.slice(textCursor)}
      </div>,
    ];

    return (
      <div className="App">
        <div className="Text">{textWithCursor}</div>
        <div className="Structure" onKeyDown={this.handleKeyDown} tabIndex="0">
          <div>
            {"Text: " + textCursor}
            {"\nStruct: " +
              this.state.cursor.node +
              ", " +
              this.state.cursor.char}
          </div>
          {renderStructElements(this.state.blocks)}
        </div>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
