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

    let pages = [
      { name: "Page 1", text: "foo: ((2))\nbar\nbaz" },
      { name: "Page 2", text: "another\npage\nbites\nthe\ndust" },
    ];

    pages.map((page) => {
      // TODO: Can we use the same incremental parser here and in the update step?
      // TODO: Do this functionally?
      const splitted = page.text.split(BLOCK_DELIM);
      let blocks = [];
      for (let i = 0; i < splitted.length; i++) {
        const start =
          i === 0
            ? 0
            : blocks[i - 1].start + splitted[i - 1].length + BLOCK_DELIM.length;
        blocks.push({
          id: LAST_BLOCK_ID + i,
          value: splitted[i],
          start: start,
        });
      }
      LAST_BLOCK_ID = LAST_BLOCK_ID + blocks.length;
      page["blocks"] = blocks;
      // TODO: Better way?
      return null;
    });

    this.state = {
      pages: pages,
      active_page: 0,
    };

    this.handleChange = this.handleChange.bind(this);
    this.handleChangeSelect = this.handleChangeSelect.bind(this);
    this.handleOnKeyDown = this.handleOnKeyDown.bind(this);
  }

  handleChange(event) {
    const page = this.state.pages[this.state.active_page];
    const new_page = { ...page, text: event.target.value };
    const new_pages = this.state.pages
      .slice(0, this.state.active_page)
      .concat(new_page, this.state.pages.slice(this.state.active_page + 1));
    this.setState({ pages: new_pages });

    // TODO: Incrementally update the parse tree...
  }

  handleChangeSelect(event) {
    // TODO: Store this as a map rather?
    const active_page = this.state.pages.findIndex(
      (x) => x.name === event.target.value
    );
    this.setState({ active_page: active_page });
  }

  handleOnKeyDown(event) {
    // Find which block is "active"...
    // First find the block that starts *after* cursor; we're in the block before that
    const page = this.state.pages[this.state.active_page];
    const blocks = page.blocks;
    const cursor = event.target.selectionStart;
    const index = blocks.findIndex((block, index) => block.start > cursor);
    const block_index = (index === -1 ? blocks.length : index) - 1;
    const block = blocks[block_index];

    // Find our position in that block?
    const block_cursor = cursor - block.start;

    // Insert the character in that block at that position...
    const key = event.key;
    let new_blocks = null;
    // TODO: Space? Punctuation? How to define all of these...
    // TODO: If no modifiers as well
    if (key.match(/^[0-9a-zA-Z()\s]$/)) {
      const new_value = block.value
        .slice(0, block_cursor)
        .concat(event.key, block.value.slice(block_cursor));
      const new_block = { ...block, value: new_value };
      new_blocks = blocks
        .slice(0, block_index)
        .concat(new_block)
        .concat(blocks.slice(block_index + 1))
        .map((block, index) =>
          index <= block_index
            ? block
            : { ...block, start: block.start + event.key.length }
        );
    }
    // Delete the character behind the position...
    else if (key === "Backspace") {
      // TODO: Probably need a better way to ensure it's not the first block,
      //       since ordering on ID isn't necessarily true
      if (block_cursor === 0) {
        if (block_index > 0) {
          // Concat the deleted blocks value onto the previous block
          const prev_block = blocks[block_index - 1];
          const new_prev_block = {
            ...prev_block,
            value: prev_block.value + block.value,
          };
          new_blocks = blocks
            .slice(0, block_index - 1)
            .concat(new_prev_block, blocks.slice(block_index + 1))
            .map((block, index) =>
              index <= block_index
                ? block
                : { ...block, start: block.start - 1 }
            );
        }
      } else {
        // Delete char
        const new_value = block.value
          .slice(0, block_cursor - 1)
          .concat(block.value.slice(block_cursor));
        const new_block = { ...block, value: new_value };
        new_blocks = blocks
          .slice(0, block_index)
          .concat(new_block)
          .concat(blocks.slice(block_index + 1))
          .map((block, index) =>
            index <= block_index ? block : { ...block, start: block.start - 1 }
          );
      }
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
      new_blocks = blocks
        .slice(0, block_index)
        .concat(newer_blocks)
        .concat(blocks.slice(block_index + 1))
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
      const new_page = { ...page, blocks: new_blocks };
      const new_pages = this.state.pages
        .slice(0, this.state.active_page)
        .concat(new_page, this.state.pages.slice(this.state.active_page + 1));
      this.setState({ pages: new_pages });
    }
  }

  render() {
    // Transform parse tree
    // Evaluate/resolve block references
    const page = this.state.pages[this.state.active_page];
    const text = page.text;
    const blocks = page.blocks;

    // TODO: Recursive block references...
    let blocks_to_search = [];
    this.state.pages.map((page) =>
      page.blocks.map((block) => blocks_to_search.push(block))
    );
    const blocks_map = {};
    blocks_to_search.map((block) => (blocks_map[block.id] = block.value));
    const evaluated_blocks = blocks.map((block) => {
      const match = block.value.match(/\(\((.*)\)\)/);
      if (match) {
        const id = match[1];
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

    const options = this.state.pages.map((x) => (
      <option value={x.name}>{x.name}</option>
    ));

    // Overall display:
    // - Editor
    // - Renderer
    return (
      <div className="App" key="0">
        <textarea
          value={text}
          onChange={this.handleChange}
          onKeyDown={this.handleOnKeyDown}
          className="Editor"
          key="0"
        />
        <select defaultValue={page.name} onChange={this.handleChangeSelect}>
          {options}
        </select>
        <div className="Renderer" key="1">
          {rendered_blocks}
        </div>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
