// TODO: Clean up "key" stuff...
// TODO: There must be a better way to handle the updating of `start`, automatically...
//       As a separate system? Tree-sitter, basically?
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";

const BLOCK_DELIM = "\n";
// TODO: Better way?
let LAST_BLOCK_ID = 0;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      text: "foo: ((2))\nbar\nbaz",
      // selectionStart: 0,
      // selectionEnd: 0,
    };

    // TODO: Can we use the same incremental parser here and in the update step?
    // TODO: Do this functionally?
    const splitted = this.state.text.split(BLOCK_DELIM);
    this.state.blocks = [];
    for (let i = 0; i < splitted.length; i++) {
      const start =
        i === 0
          ? 0
          : this.state.blocks[i - 1].start +
            splitted[i - 1].length +
            BLOCK_DELIM.length;
      this.state.blocks.push({ id: i, value: splitted[i], start: start });
    }
    LAST_BLOCK_ID = this.state.blocks.length - 1;
    // console.log(this.state.blocks);
    // this.state.blocks = this.state.text.split(BLOCK_DELIM).map((value, id) => {
    //   if (id === 0) {
    //     start = 0
    //   } else {
    //     start =
    //   }
    //   return {id: id, value: value, start: start};
    // });

    this.handleChange = this.handleChange.bind(this);
    this.handleOnKeyDown = this.handleOnKeyDown.bind(this);
  }

  handleChange(event) {
    this.setState({ text: event.target.value });

    // TODO: Incrementally update the parse tree...
  }

  handleOnKeyDown(event) {
    // Find which block is "active"...
    // First find the block that starts *after* cursor; we're in the block before that
    const cursor = event.target.selectionStart;
    const index = this.state.blocks.findIndex(
      (block, index) => block.start > cursor
    );
    const block_index = (index === -1 ? this.state.blocks.length : index) - 1;
    const block = this.state.blocks[block_index];

    // Find our position in that block?
    const block_cursor = cursor - block.start;
    // console.log(
    //   "You're in block " + block_index + " at position " + block_cursor
    // );

    // Insert the character in that block at that position...
    // TODO: Clean up this logic
    const key = event.key;
    let new_blocks = null;
    // TODO: Space? Punctuation? How to define all of these...
    if (key.match(/^[0-9a-zA-Z()]$/)) {
      const new_value = block.value
        .slice(0, block_cursor)
        .concat(event.key, block.value.slice(block_cursor));
      const new_block = { ...block, value: new_value };
      new_blocks = this.state.blocks
        .slice(0, block_index)
        .concat(new_block)
        .concat(this.state.blocks.slice(block_index + 1))
        .map((block, index) =>
          index <= block_index
            ? block
            : { ...block, start: block.start + event.key.length }
        );
    }
    // Delete the character behind the position...
    else if (key === "Backspace") {
      const new_value = block.value
        .slice(0, block_cursor - 1)
        .concat(block.value.slice(block_cursor));
      const new_block = { ...block, value: new_value };
      new_blocks = this.state.blocks
        .slice(0, block_index)
        .concat(new_block)
        .concat(this.state.blocks.slice(block_index + 1))
        .map((block, index) =>
          index <= block_index ? block : { ...block, start: block.start - 1 }
        );
    }
    // Create a new block
    else if (key === "Enter") {
      // Create the new block
      const splitted = [
        block.value.slice(0, block_cursor),
        block.value.slice(block_cursor),
      ];
      // TODO: Make a func? Make immutable?
      let new_block_id = LAST_BLOCK_ID + 1;
      LAST_BLOCK_ID = new_block_id;

      let first_id = null;
      let second_id = null;
      // Cursor is at the end of the block
      if (block_cursor === block.value.length - 1) {
        first_id = new_block_id;
        second_id = block.id;
      } else {
        first_id = block.id;
        second_id = new_block_id;
      }
      const newer_blocks = [
        { id: first_id, value: splitted[0], start: block.start },
        {
          id: second_id,
          value: splitted[1],
          start: block.start + splitted[0].length,
        },
      ];

      // Update block tree
      new_blocks = this.state.blocks
        .slice(0, block_index)
        .concat(newer_blocks)
        .concat(this.state.blocks.slice(block_index + 1))
        // Update block tree index
        .map((block, index) =>
          index <= block_index ? block : { ...block, start: block.start + 1 }
        );
      console.log(new_blocks);
    } else {
      console.log("Ignoring unknown key: " + key);
    }

    // Update the block starts / index...
    if (new_blocks) {
      this.setState({ blocks: new_blocks });
    }

    // TODO: Is this not allowing me to key repeat? Any way to do this on key down? Does it matter?
    // If there's no selection
    // if (
    //   event.target.selectionStart === event.target.selectionEnd &&
    //   // Cursor moved
    //   event.target.selectionStart !== this.state.selectionStart
    // ) {
    //   // console.log("Cursor moved - no selection");
    // }

    // this.setState({ selectionStart: event.target.selectionStart });
    // this.setState({ selectionEnd: event.target.selectionEnd });
  }

  render() {
    // TODO: Need a better way to ID blocks... But does that need tree-sitter?
    //       Else how do we know which block we're editing?... Need to reflect
    //       on this.
    // Parse input text stream

    // Transform parse tree
    // Evaluate/resolve block references
    // TODO: Clean this shit up
    const blocks_map = {};
    this.state.blocks.map((block) => (blocks_map[block.id] = block.value));
    const evaluated_blocks = this.state.blocks.map((block) => {
      const match = block.value.match(/\(\((.*)\)\)/);
      if (match) {
        const id = match[1];
        // console.log("Block " + block.id + " has ref to block " + id);
        // console.log(match);
        const split = block.value.split(match[0]);
        const split2 = [
          split[0],
          <div className="BlockRef" key="0">
            ({id}) {blocks_map[id]}
          </div>,
          split[1],
        ];
        return { id: block.id, value: split2 };
      }
      return block;
    });

    // Render the parse tree
    const rendered_blocks = evaluated_blocks.map((block) => {
      return (
        <div className="Block" key={block.id}>
          ({block.id}) {block.value}
        </div>
      );
    });

    // Overall display:
    // - Editor
    // - Renderer
    return (
      <div className="App" key="0">
        <textarea
          value={this.state.text}
          onChange={this.handleChange}
          onKeyDown={this.handleOnKeyDown}
          className="Editor"
          key="0"
        />
        <div className="Renderer" key="1">
          {rendered_blocks}
        </div>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
