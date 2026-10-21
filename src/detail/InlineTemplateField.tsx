import { TextCellSurface } from '../table/TextCellSurface';
import { readableTemplateText, literalTemplateSource } from './inline-template-text.mjs';
import { templateNodes, serializeTemplateNodes, selectionSplitsEffect, templateSelectionSource, templateScopeSelector } from './inline-template-dom.mjs';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { ActiveTextEditorRegistrar } from '../editing';
import type { InlineTemplateDefinition } from './useInlineTemplateDefinitions';

type Props = {projectId?:string|null;sourcePath:string|null;collectionPath:string;rowId:string|null;field:string;definition?:InlineTemplateDefinition;table?:boolean;interaction?:{cellId:string;editable:boolean;active:boolean;wrapped:boolean;onEnableEditing:()=>void;onActivate:(id:string)=>void;onDeactivate:(id:string)=>void};value:Record<string,unknown>;onChange:(value:Record<string,unknown>)=>void;register?:ActiveTextEditorRegistrar;fallback:React.ReactNode};

export function TemplateEditor({identity,source,onChange,register,label="可读描述",refreshRevision=0,table=false,tableWrapped=false,onDeactivate}:{identity:string;source:string;onChange:(source:string)=>void;register?:ActiveTextEditorRegistrar;label?:string;refreshRevision?:number;table?:boolean;tableWrapped?:boolean;onDeactivate?:()=>void}) {
 const ref=useRef<HTMLDivElement>(null);const latest=useRef(source);const committed=useRef(source);const initial=useRef(source);const initialNodes=useRef<Node[]>([]);const emit=useRef(onChange);emit.current=onChange;
 const editing=useRef(false);const edited=useRef(false);const [blurRevision,setBlurRevision]=useState(0);
 const [clipboardNotice,setClipboardNotice]=useState('');
 const serialize=()=>ref.current?serializeTemplateNodes(ref.current):latest.current;
 const draftGeneration=useRef(0);const acknowledgedDraft=useRef(0);const receivedSource=useRef(source);const lastRefresh=useRef(refreshRevision);
 const adoption=useRef({revision:refreshRevision,baseline:source,draft:0,source:null as string|null});
 const flush=()=>{const text=serialize();if(text===committed.current)return;committed.current=text;latest.current=text;emit.current(text);};
 const flushRef=useRef(flush);flushRef.current=flush;const handle=useRef({identityKey:identity,flushDraft:()=>flushRef.current()});
 useEffect(()=>()=>register?.(null,handle.current),[identity,register]);
 useEffect(()=>{
  const element=ref.current;if(!element)return;
  // Observe parent acknowledgements even while native editing defers the repaint.
  // A byte string from an older edit is not a permanent veto on a later adoption.
  const previousSource=receivedSource.current;receivedSource.current=source;
  if(adoption.current.revision!==refreshRevision){
   adoption.current={revision:refreshRevision,baseline:previousSource,draft:draftGeneration.current,source:source!==previousSource?source:null};
  }else if(lastRefresh.current!==refreshRevision&&source!==adoption.current.baseline){
   adoption.current.source=source;
  }
  if(source===latest.current)acknowledgedDraft.current=draftGeneration.current;
  if(editing.current&&edited.current)return;
  const adopted=lastRefresh.current!==refreshRevision&&adoption.current.source===source&&adoption.current.draft===draftGeneration.current;
  // Only an unacknowledged draft is protected. An explicit new adoption may
  // normalize it back to historical bytes once its source advances from baseline.
  if(acknowledgedDraft.current<draftGeneration.current&&source!==latest.current&&!adopted)return;
  const forced=lastRefresh.current!==refreshRevision;lastRefresh.current=refreshRevision;
  if(forced){initial.current=source;committed.current=source;}
  if(element.childNodes.length&&source===latest.current)return;
  const selection=window.getSelection();let caret:number|null=null;
  if(selection?.rangeCount&&element.contains(selection.anchorNode)) {const range=selection.getRangeAt(0).cloneRange();range.selectNodeContents(element);range.setEnd(selection.anchorNode!,selection.anchorOffset);caret=range.toString().length;}
  element.replaceChildren(templateNodes(source));latest.current=source;committed.current=source;initial.current=source;initialNodes.current=Array.from(element.childNodes).map(node=>node.cloneNode(true));acknowledgedDraft.current=draftGeneration.current;
  if(caret!==null&&selection){const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let n:Node|null;let remaining=caret;while((n=walk.nextNode())){if(remaining<=(n.textContent?.length??0)){const range=document.createRange();range.setStart(n,remaining);range.collapse(true);selection.removeAllRanges();selection.addRange(range);break;}remaining-=n.textContent?.length??0;}}
 },[identity,source,refreshRevision,blurRevision]);
 useEffect(()=>{if(table&&ref.current){ref.current.focus();const range=document.createRange();range.selectNodeContents(ref.current);range.collapse(false);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);}},[identity,table]);
 const cancel=()=>{if(ref.current){ref.current.replaceChildren(...initialNodes.current.map(node=>node.cloneNode(true)));latest.current=initial.current;acknowledgedDraft.current=draftGeneration.current;}};
 const copy=(event:React.ClipboardEvent<HTMLDivElement>,cut=false)=>{
   const selection=window.getSelection();if(!selection?.rangeCount)return;
   const range=selection.getRangeAt(0);if(!ref.current?.contains(range.commonAncestorContainer))return;
   event.preventDefault();
   const common=range.commonAncestorContainer instanceof Element?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
   const nearest=common?.closest(templateScopeSelector);
   if(nearest?.parentElement?.closest(templateScopeSelector)){setClipboardNotice('请完整选择最外层描述片段再复制或剪切，避免丢失关联。');return;}
   if(selectionSplitsEffect(ref.current,range)){setClipboardNotice('请完整选择描述片段再复制或剪切，避免丢失关联。');return;}
   setClipboardNotice('');
   const enclosing=nearest;
   if(enclosing&&ref.current.contains(enclosing)){range.selectNode(enclosing);selection.removeAllRanges();selection.addRange(range);}
   const complete=selection.toString()===ref.current.textContent;
   const copiedSource=complete?serialize():templateSelectionSource(ref.current,range),copiedText=selection.toString();
   event.clipboardData.setData('application/x-inline-template',JSON.stringify({scope:identity.slice(0,identity.lastIndexOf(':')),source:copiedSource}));
   event.clipboardData.setData('text/plain',copiedText);
   if(cut){
    // Chromium may keep an empty selected inline wrapper for native undo.
    // Mark only those exact cut nodes; authored empty/unfinished scopes retain
    // their original markup and must still fail explicit generation.
    const selectedScopes=Array.from(ref.current.querySelectorAll(templateScopeSelector)).filter(node=>range.intersectsNode(node));
    document.execCommand('delete');
    for(const node of selectedScopes)if(node.isConnected&&!node.textContent){(node as HTMLElement).dataset.templateCutEmpty='true';const caret=document.createRange();caret.setStartAfter(node);caret.collapse(true);selection.removeAllRanges();selection.addRange(caret);}
    edited.current=true;draftGeneration.current+=1;latest.current=serialize();if(!table)flush();
   }
 };
 return <><div ref={ref} role="textbox" aria-label={label} aria-multiline="true" contentEditable suppressContentEditableWarning className={table?'inline-template-table-input':'detail-input detail-textarea'} style={table?{whiteSpace:tableWrapped?'pre-wrap':'pre',border:0,outline:0,padding:0,width:'100%',minWidth:0,font:'inherit',lineHeight:'inherit',background:'transparent',userSelect:'text',cursor:'text'}:{whiteSpace:'pre-wrap',minHeight:74}} onFocus={()=>{editing.current=true;register?.(handle.current);}} onInput={()=>{edited.current=true;draftGeneration.current+=1;if(!table){flush();return;}const text=serialize();latest.current=text;}} onBlur={()=>{flush();editing.current=false;edited.current=false;setBlurRevision(n=>n+1);register?.(null,handle.current);onDeactivate?.();}} onKeyDown={event=>{if(!table||event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}else if(event.key==='Escape'){event.preventDefault();cancel();event.currentTarget.blur();}}}
  onCopy={event=>copy(event)} onCut={event=>copy(event,true)} onPaste={event=>{
   event.preventDefault();edited.current=true;let text=event.clipboardData.getData('text/plain');
   let structuredSource:string|null=null;
   try{const structured=JSON.parse(event.clipboardData.getData('application/x-inline-template'));if(structured.scope===identity.slice(0,identity.lastIndexOf(':'))&&typeof structured.source==='string')structuredSource=structured.source;}catch{/* External text carries no identity. */}
   if(structuredSource!==null){
    const selection=window.getSelection();const anchor=selection?.anchorNode;const parent=anchor instanceof Element?anchor:anchor?.parentElement;
    if(structuredSource.includes('<effect ')&&parent?.closest('[data-template-effect]')){setClipboardNotice('效果片段不能嵌套，请粘贴到现有片段外。');return;}
    if(structuredSource.includes('<cost>')&&parent?.closest('[data-template-section="cost"]')){setClipboardNotice('描述分段不能嵌套，请粘贴到现有分段外。');return;}
    const container=document.createElement('div');container.append(templateNodes(structuredSource));
    document.execCommand('insertHTML',false,container.innerHTML);
   }else {
    const container=document.createElement('div');container.append(templateNodes(literalTemplateSource(text)));
    document.execCommand('insertHTML',false,container.innerHTML);
   }
   setClipboardNotice(structuredSource===null?'关联未携带，需生成检查':'');draftGeneration.current+=1;latest.current=serialize();if(!table)flush();
  }}/>{clipboardNotice?<div role="status">{clipboardNotice}</div>:null}</>;
}

/** Project-declared template fields only. No game identifiers or arithmetic live here. */
export function InlineTemplateField(props:Props) {
 const locales=[...new Set([...(props.definition?.languages.map(x=>x.key)??[]),...Object.keys(props.value).filter(k=>typeof props.value[k]==='string')])];
 const [selected,setSelected]=useState(props.definition?.tableLanguage??locales[0]);
 const locale=props.table?(props.definition?.tableLanguage??locales[0]):locales.includes(selected)?selected:locales[0];
 const labelFor=(key:string)=>props.definition?.languages.find(x=>x.key===key)?.label??key;
 const active=useRef<{flushDraft:()=>void}|null>(null);
 const [adoption,setAdoption]=useState(0);
 useEffect(()=>{const adopt=()=>setAdoption(n=>n+1);window.addEventListener('inline-template-generation-adopted',adopt);return()=>window.removeEventListener('inline-template-generation-adopted',adopt);},[]);
 const register:ActiveTextEditorRegistrar=useCallback((handle,previous)=>{if(handle||active.current===previous)active.current=handle;props.register?.(handle,previous);},[props.register]);
 if(!props.definition)return <>{props.fallback}</>;
 const editor=<TemplateEditor refreshRevision={adoption} key={`${props.projectId}:${props.sourcePath}:${props.rowId}:${props.field}:${locale}`} identity={`${props.projectId}:${props.sourcePath}:${props.rowId}:${props.field}:${locale}`} source={String(props.value[locale]??'')} register={register} table={props.table} tableWrapped={props.interaction?.wrapped} onDeactivate={props.interaction?()=>props.interaction!.onDeactivate(props.interaction!.cellId):undefined} label={props.table?`${props.definition?.label??props.field}（${labelFor(locale)}）`:'可读描述'} onChange={source=>props.onChange({...props.value,[locale]:source})}/>;
 if(props.table&&props.interaction){
  const text=readableTemplateText(props.value[locale]);
  return <div title="作者草稿；生成时核对来源" style={{width:'100%'}}><TextCellSurface {...props.interaction} value={text} wrapped={props.interaction.wrapped} onChangeValue={()=>{}} onRegisterActiveEditor={props.register} displayContent={<span style={{display:'block',minWidth:0,maxWidth:'100%',overflow:props.interaction.wrapped?'visible':'hidden',whiteSpace:props.interaction.wrapped?'normal':'nowrap',textOverflow:'ellipsis'}}>{text.split(/(<[^<>]+>|\{[^{}]+\}|\[[^\[\]]+\])/g).map((part:string,index:number)=>/^(?:<[^<>]+>|\{[^{}]+\}|\[[^\[\]]+\])$/.test(part)?<span key={index} style={{display:'inline',whiteSpace:'inherit',background:'#463b28',color:'#ffdc91',borderRadius:3,padding:'0 3px'}}>{part}</span>:part)}</span>} editorContent={<div className={`table-text-cell-editor editable-cell cell-display cell-text-content ${props.interaction.wrapped?'cell-text-wrap':''}`} data-cell-role="editor" onClick={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>{editor}</div>}/></div>;
 }
 return <div data-inline-template-field={props.field}>
  <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:6}}>作者草稿；生成时核对来源</div>
  {!props.table&&locales.length>1?<div role="tablist" aria-label="描述语言" style={{display:'flex',gap:8,marginBottom:8}}>{locales.map(key=><button type="button" role="tab" aria-selected={locale===key} key={key} onClick={()=>{active.current?.flushDraft();setSelected(key);}}>{labelFor(key)}</button>)}</div>:null}
  {editor}
 </div>;
}
