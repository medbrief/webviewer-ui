import React from 'react';
import PropTypes from 'prop-types';
import { AutoSizer, CellMeasurer, CellMeasurerCache, List } from 'react-virtualized';
import { connect } from 'react-redux';
import { translate } from 'react-i18next';

import Dropdown from 'components/Dropdown';
import Note from 'components/Note';
import ListSeparator from 'components/ListSeparator';

import core from 'core';
import sortMap from 'constants/sortMap';
import selectors from 'selectors';

import './NotesPanel.scss';

class NotesPanel extends React.PureComponent {
  static propTypes = {
    isDisabled: PropTypes.bool,
    display: PropTypes.string.isRequired,
    sortNotesBy: PropTypes.string.isRequired,
    expandedNotes: PropTypes.object.isRequired,
    t: PropTypes.func.isRequired
  }
  
  constructor() {
    super();
    this.state = {
      noteStates: {}, 
      searchInput: ''
    };
    this.cache = new CellMeasurerCache({
      defaultHeight: 60,
      fixedWidth: true
    });
    this.listRef = React.createRef();
    this.rootAnnotations = [];
    this.updatePanelOnInput = _.debounce(this.updatePanelOnInput.bind(this), 500);
  }

  componentDidMount() {
    core.addEventListener('documentUnloaded', this.onDocumentUnloaded);
    core.addEventListener('addReply', this.onAddReply);
    core.addEventListener('deleteReply', this.onDeleteReply);
    core.addEventListener('annotationSelected', this.onAnnotationSelected);
    core.addEventListener('annotationChanged', this.onAnnotationChanged);
    core.addEventListener('annotationHidden', this.onAnnotationChanged);
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      prevProps.sortNotesBy !== this.props.sortNotesBy ||
      prevProps.expandedNotes !== this.props.expandedNotes ||
      Object.keys(prevState.noteStates).length !== Object.keys(this.state.noteStates).length
    ) {
      this.updateList();
    }
  }

  componentWillUnmount() {
    core.removeEventListener('documentUnloaded', this.onDocumentUnloaded);
    core.removeEventListener('addReply', this.onAddReply);
    core.removeEventListener('deleteReply', this.onDeleteReply);
    core.removeEventListener('annotationSelected', this.onAnnotationSelected);
    core.removeEventListener('annotationChanged', this.onAnnotationChanged);
    core.removeEventListener('annotationHidden', this.onAnnotationChanged);
  }

  onDocumentUnloaded = () => {
    this.setState({ noteStates: {} });
  }

  onAddReply = (e, reply, parent) => {
    this.setNoteState(parent.Id, {
      replies: {
        ...this.state.noteStates[parent.Id].replies,
        [reply.Id]: { 
          isReplyContentEditing: false,
          canModify: core.canModify(reply) 
        }
      }
    });
  }

  onDeleteReply = (e, reply, parent) => {
    const replies = { ...this.state.noteStates[parent.Id].replies };
    
    delete replies[reply.Id];
    setTimeout(() => {
      this.setNoteState(parent.Id, { replies });
    }, 0);
  }

  setNoteState = (Id, newState) => {
    if (!this.state.noteStates[Id]) {
      return;
    }

    this.setState({
      noteStates: {
        ...this.state.noteStates,
        [Id]: {
          ...this.state.noteStates[Id],
          ...newState
        }
      }
    });
  }

  onAnnotationSelected = (e, annotations, action) => {
    if ( action === 'selected' && annotations.length === 1) {
      const selectedNoteIndex = this.getSortedNotes(this.state.noteStates).findIndex(note => note.Id === annotations[0].Id);

      this.listRef.current.scrollToRow(selectedNoteIndex); 
    }
  }

  onAnnotationChanged = () => {
    // TODO, this causes unnecessary rerendering sometimes. 
    // for example, changing the color of an annotation will also trigger this event.
    this.setRootAnnotations();
    const notesToRender = this.filterAnnotations(this.rootAnnotations, this.state.searchInput);
    this.setState({ noteStates: this.getNoteStates(notesToRender) }, this.updateList);  
  }

  getSortedNotes = noteStates => {
    const notes = Object.keys(noteStates).map(core.getAnnotationById);
    
    return sortMap[this.props.sortNotesBy].getSortedNotes(notes);
  }

  updateList = () => {
    this.cache.clearAll();
    if (this.listRef.current) {
      this.listRef.current.recomputeRowHeights();
    }
  }

  setRootAnnotations = () => {
    this.rootAnnotations = core.getAnnotationsList().filter(annotation => annotation.Listable && !annotation.isReply() && !annotation.Hidden);
  }

  getNoteStates = notesToRender => {
    return notesToRender.reduce((noteStates, note) => {
      let noteState = this.state.noteStates[note.Id]; 
      if (!noteState) {
        noteState = {
          annotation: note,
          isRootContentEditing: false,
          isReplyFocused: false,
          canModify: core.canModify(note),
          replies: note.getReplies().reduce((replies, reply) => {
            replies[reply.Id] = { 
              isReplyContentEditing: false,
              canModify:  core.canModify(note)
            };
            return replies;
          }, {})
        };
      }

      noteStates[note.Id] = noteState;
      return noteStates;
    }, {});
  } 

  handleInputChange = e => {
    const searchInput = e.target.value;

    this.updatePanelOnInput(searchInput);
  }

  updatePanelOnInput = searchInput => {
    let notesToRender;

    core.deselectAllAnnotations();
    if (searchInput.trim()) {
      notesToRender = this.filterAnnotations(this.rootAnnotations, searchInput);
    } else { 
      notesToRender = this.rootAnnotations;
    }
    
    this.setState({ noteStates: this.getNoteStates(notesToRender), searchInput }, () => {
      if (searchInput.trim()) {
        core.selectAnnotations(notesToRender); 
      }
    });
  }

  filterAnnotations = (annotations, searchInput) => {
    return annotations.filter(rootAnnotation => {
      const replies = rootAnnotation.getReplies();
      // reply is also a kind of annotation
      // https://www.pdftron.com/api/web/CoreControls.AnnotationManager.html#createAnnotationReply__anchor
      const annotations = [ rootAnnotation, ...replies ];

      return annotations.some(annotation => {
        const content = annotation.getContents();
        const authorName = core.getDisplayAuthor(annotation);

        return this.isInputIn(content, searchInput) || this.isInputIn(authorName, searchInput);
      });
    });
  }

  isInputIn = (string, searchInput) => {
    if (!string) {
      return false;
    }

    return string.search(new RegExp(searchInput, 'i')) !== -1;
  }

  renderNotesPanelContent = () => {
    const { noteStates } = this.state;
    const notesToRender = this.getSortedNotes(noteStates);

    console.log(notesToRender);

    return(
      <React.Fragment>
        <div className={`notes-wrapper ${notesToRender.length ? 'visible' : 'hidden'}`}>
          <AutoSizer>
            {({ height, width }) => (
              <List
                ref={this.listRef}
                width={width}
                height={height}
                rowCount={notesToRender.length}
                deferredMeasurementCache={this.cache}
                rowHeight={this.cache.rowHeight}
                rowRenderer={({ index, style, parent }) => (
                  <CellMeasurer
                    cache={this.cache}
                    columnIndex={0}
                    // If using the default key provided rowRenderer, when inserting a new row at the beginning,
                    // it seems RV will insert it at the end, which will have wrong textarea value. So we use a 'custom' key here
                    key={notesToRender[index].Id} 
                    parent={parent}
                    rowIndex={index}
                  >
                    {({ measure }) => (
                      <div className="note-wrapper" style={{ ...style }}>
                        {this.renderListSeparator(notesToRender, index)}
                        <Note
                          {...noteStates[notesToRender[index].Id]}
                          setNoteState={this.setNoteState}
                          searchInput={this.state.searchInput}
                          measure={measure}
                        />
                      </div>
                    )}
                  </CellMeasurer>
                )}
              />
            )}
          </AutoSizer>
        </div>
        <div className={`no-results ${notesToRender.length ? 'hidden' : 'visible'}`}>
          {this.props.t('message.noResults')}
        </div>
      </React.Fragment>
    );
  }

  renderListSeparator = (notes, index) => {
    const { shouldRenderSeparator, getSeparatorContent } = sortMap[this.props.sortNotesBy];
    const currNote = notes[index];
    const prevNote = index === 0 ? currNote: notes[index-1];
    const isFirstNote = prevNote === currNote;

    if (
      shouldRenderSeparator && 
      getSeparatorContent &&
      (isFirstNote || shouldRenderSeparator(prevNote, currNote))
    ) {
      return <ListSeparator renderContent={() => getSeparatorContent(prevNote, currNote)} />;
    }

    return null;
  }

  render() {
    const { isDisabled, display, t } = this.props;

    if (isDisabled) {
      return null;
    }
    
    return (
      <div 
        className="Panel NotesPanel" 
        style={{ display }}
        data-element="notesPanel" 
        onClick={() => core.deselectAllAnnotations()}
        onScroll={e => e.stopPropagation()}
      >
        {this.rootAnnotations.length === 0 
        ? <div className="no-annotations">{t('message.noAnnotations')}</div>
        : <React.Fragment>
            <div className="header">
              <input 
                type="text" 
                placeholder={t('message.searchPlaceholder')}
                onChange={this.handleInputChange} 
              />
              <Dropdown items={Object.keys(sortMap)} />
            </div>
            {this.renderNotesPanelContent()}
          </React.Fragment>
        }
      </div>
    );
  }
}

const mapStatesToProps = state => ({
  sortNotesBy: selectors.getSortNotesBy(state),
  isDisabled: selectors.isElementDisabled(state, 'notesPanel'),
  expandedNotes: selectors.getExpandedNotes(state)
});

export default connect(mapStatesToProps)(translate()(NotesPanel));
