import {EditorState, Compartment} from '@codemirror/state';
import {EditorView, keymap, placeholder, lineNumbers} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {syntaxHighlighting, HighlightStyle, bracketMatching} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {markdown} from '@codemirror/lang-markdown';
import {json} from '@codemirror/lang-json';

export function textEditor(parent, {value='', label, format='markdown', onChange=()=>{}}) {
  const editable = new Compartment();
  const view = new EditorView({parent, state:EditorState.create({doc:value, extensions:[
    history(), keymap.of([...defaultKeymap,...historyKeymap]), EditorView.lineWrapping,
    syntaxHighlighting(HighlightStyle.define([
      {tag:[tags.keyword,tags.bool,tags.null,tags.number],color:'var(--accent-text)'},
      {tag:[tags.string,tags.comment],color:'var(--muted)'},
      {tag:tags.heading,color:'var(--strong)',fontWeight:'600'},
      {tag:tags.strong,fontWeight:'600'}, {tag:tags.emphasis,fontStyle:'italic'},
    ])), bracketMatching(),
    format==='json' ? [json(),lineNumbers()] : markdown(),
    placeholder(format==='json' ? '输入 JSON' : '写下职责、执行逻辑或源码依据…'),
    EditorView.contentAttributes.of({'aria-label':label,'aria-multiline':'true','spellcheck':'false'}),
    editable.of(EditorState.readOnly.of(false)),
    EditorView.updateListener.of(update=>{if(update.docChanged)onChange(update.state.doc.toString());}),
  ]})});
  return {get value(){return view.state.doc.toString();}, focus:()=>view.focus(), destroy:()=>view.destroy(),
    setReadOnly(value){view.dispatch({effects:editable.reconfigure(EditorState.readOnly.of(value))});}};
}
