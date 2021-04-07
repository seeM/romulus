import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
        value: 'Foo\nBar\nBaz',
    };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    this.setState({value: event.target.value});
  }

  handleOnKeyDown(event) {
    if (event.key.match(/^[0-9a-zA-Z]$/)) {
      console.log(event.key);
    }
  }

  // TODO: How to do all of this incrementally?
  render() {

    // Parse input text stream
    const blocks = this.state.value.split("\n\n");

    // Render the parse tree
    const rendered_blocks = blocks.map(block => <div className="Block">{block}</div>);

    // Overall display:
    // - Editor
    // - Renderer
    return (
        <div className="App">
          <textarea value={this.state.value} onChange={this.handleChange} className="Editor" />
          <div className="Renderer">
            {rendered_blocks}
          </div>
        </div>
    );
  }
}

ReactDOM.render(
  <App />,
  document.getElementById('root')
);
