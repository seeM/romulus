// TODO: Refactor cursor to point to actual node not id?
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";

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
      };
      const second = {
        type: "ref",
        text: match[0],
        value: refBlock,
        start: first.start + first.text.length,
        parent: block,
      };
      const third = {
        type: "text",
        text: plainText[1],
        value: plainText[1],
        start: second.start + second.text.length,
        parent: block,
      };
      children = [first, second, third];
    } else {
      children.push({
        type: "text",
        text: block.text,
        value: block.text,
        start: 0,
        parent: block,
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

  return [blocks, nodes];
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

class App extends React.Component {
  constructor(props) {
    super(props);
    const [blocks, nodes] = deserialize(TEXT);
    this.state = {
      blocks: blocks,
      nodes: nodes,
      structCursor: { node: 0, char: 0 },
    };
    console.log(nodes);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  handleKeyDown(event) {
    let structCursor = this.state.structCursor;
    const nodes = this.state.nodes;

    // The structCursor moves along nodes, and we easily translate from
    // that to the block and text co-ordinate systems as needed. Nodes know
    // their position in a block, and blocks know their position in the text.

    // TODO: In reality, up and down would need to move along virtual lines
    // (since blocks may wrap), not blocks. This will be a terrible UX as it
    // is!

    const key = event.key;
    if (key === "ArrowUp") {
      const prev = nodes[structCursor.node].parent.prev;
      if (prev) {
        // Not at the first block, move to the previous block.
        // TODO: If the block has no children we're screwed - is that possible?
        // TODO: Should nodes know their position?
        structCursor.node = nodes.findIndex((x) => x === prev.children[0]);
        structCursor.char = 0;
      } else {
        // At the first block, do nothing.
      }
    } else if (key === "ArrowDown") {
      const next = nodes[structCursor.node].parent.next;
      if (next) {
        // Not at the last block, move to the next block.
        // TODO: If the block has no children we're screwed - is that possible?
        // TODO: Should nodes know their position?
        structCursor.node = nodes.findIndex((x) => x === next.children[0]);
        structCursor.char = 0;
      } else {
        // At the last block, do nothing.
      }
    } else if (key === "ArrowLeft") {
      if (structCursor.char <= 0) {
        // At the beginning of a node.
        if (structCursor.node <= 0) {
          // At the beginning of the first node, do nothing.
        } else {
          // At the beginning of a node
          const node = nodes[structCursor.node].prev;
          if (node.parent !== nodes[structCursor.node].parent) {
            // Moved to a new block.
            structCursor.node--;
            // TODO: We're doing the same shitty assumption about rendering here...
            structCursor.char = node.rendered.length;
          } else if (node.type === "text") {
            // Go to the last char of the previous node.
            structCursor.node--;
            // TODO: We're doing the same shitty assumption about rendering here...
            structCursor.char = node.rendered.length - 1;
          } else if (node.type === "ref") {
            // Go to the start of the previous node.
            structCursor.node--;
            structCursor.char = 0;
          } else {
            throw new Error("Unknown node type: " + node.type);
          }
        }
      } else {
        // Not at the beginning of a node
        // Go back one char.
        structCursor.char--;
      }
    } else if (key === "ArrowRight") {
      if (structCursor.char >= nodes[structCursor.node].text.length) {
        // At the end of a node.
        if (structCursor.node >= nodes.length - 1) {
          // At the end of the last node, do nothing.
        } else {
          // At the end of a node.
          const node = nodes[structCursor.node].next;
          if (node.parent !== nodes[structCursor.node].parent) {
            // Moved to a new block.
            structCursor.node++;
            structCursor.char = 0;
          } else if (node.type === "text") {
            // Move one char into the next node.
            structCursor.node++;
            structCursor.char = 1;
          } else if (node.type === "ref") {
            // Go forward passed the ref's rendered text.
            // TODO: This ain't good because we're contaminating cursor movement with rendering logic.
            // I.e. the assumption about how refs are rendered... Need a better way!
            // structCursor.char += BLOCK_REF_DELIM_LENGTH + node.value.text.length;
            structCursor.node += 2;
            structCursor.char = 0;
            // TODO: Can't we just move to the next node? And deal with where these nodes are within a block
            // only at text render time??? Booyakasha
          } else {
            throw new Error("Unknown node type: " + node.type);
          }
        }
      } else {
        // Not at the end of a node, go forward one char.
        structCursor.char++;
      }
    } else {
    }

    this.setState({ structCursor: structCursor });
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

    // Translate structCursor to textCursor
    const structCursor = this.state.structCursor;
    const node = this.state.nodes[structCursor.node];
    const nodes = this.state.nodes;
    const nodeIndex = nodes.findIndex((n) => n === node);
    const nodeCharOffset = nodes
      .slice(0, nodeIndex)
      .map((n) => n.rendered.length)
      .reduce((a, b) => a + b, 0);
    const block = node.parent;
    const blockIndex = blocks.findIndex((b) => b === block); // TODO: Shitty way to account for newlines
    const textCursor = nodeCharOffset + blockIndex + structCursor.char;

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
              this.state.structCursor.node +
              ", " +
              this.state.structCursor.char}
          </div>
          {renderStructElements(this.state.blocks)}
        </div>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
