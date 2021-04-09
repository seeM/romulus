import React from "react";
import ReactDOM from "react-dom";
import "./index.css";

// Some text to play with
const TEXT = "foo: ((2))\nbar\nbaz";

const BLOCK_DELIM = "\n";
const BLOCK_REF_PATTERN = /\(\((.*)\)\)/;
let LAST_BLOCK_ID = 0;

function deserialize(text) {
  // Parse blocks
  let blocks = [];
  const blockTexts = text.split(BLOCK_DELIM);
  for (let i = 0; i < blockTexts.length; i++) {
    const start =
      i === 0
        ? 0
        : blocks[i - 1].start + blockTexts[i - 1].length + BLOCK_DELIM.length;
    blocks.push({
      type: "block",
      id: LAST_BLOCK_ID + i,
      text: blockTexts[i],
      start: start,
    });
    LAST_BLOCK_ID += 1;
  }

  // Parse inlines
  blocks = blocks.map((block) => {
    // TODO: This is a super naive parser...
    // Parse block references
    let children = null;
    const match = block.text.match(BLOCK_REF_PATTERN);
    if (match) {
      const ref_start = match[1];
      const plain_text = block.text.split(match[0]);
      children = [
        { type: "text", value: plain_text[0] },
        { type: "ref", start: ref_start },
        { type: "text", value: plain_text[1] },
      ];
    } else {
      children = [{ type: "text", value: block.text }];
    }
    return { ...block, children: children };
  });

  return blocks;
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = { blocks: deserialize(TEXT) };
  }

  render() {
    const structure = this.state.blocks.map((block) => {
      return (
        <div className="Block" key={block.id}>
          ({block.id}) {block.text}
        </div>
      );
    });

    return (
      <div className="App">
        <div className="Structure">{structure}</div>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
