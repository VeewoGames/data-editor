import {keywordSourceFromDisplay,balancedTemplateScopes} from './inline-template-text.mjs';

const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const decode=text=>text.replace(/&(amp|lt|gt|quot);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"'})[key]);
export const templateScopeSelector='[data-template-effect], [data-template-section="cost"]';
function appendText(parent,raw){
 // Encoded literal markup stays literal across save; it must never gain control identity.
 if(!/&(amp|lt|gt|quot);/.test(raw)){parent.append(document.createTextNode(raw));return;}
 const span=document.createElement('span');span.dataset.templateLiteral=raw;span.dataset.templateLiteralDisplay=decode(raw);span.textContent=decode(raw);parent.append(span);
}

/** Generic author markup only. Containers retain boundaries through native edits. */
export function templateNodes(source){
 if(!balancedTemplateScopes(source))return document.createTextNode(source);
 const root=document.createDocumentFragment();const parents=[root];
 const expression=/<effect ref="([a-z][a-z0-9_]{0,63})">|<\/effect>|<value ref="([a-z][a-z0-9_]{0,63})"\s*\/>|<value ref="([a-z][a-z0-9_]{0,63})">([^<>]+)<\/value>|<kw id="([a-z][a-z0-9_]{0,63})" mode="(default|alt)">([^<>]+)<\/kw>|<cost>|<\/cost>/g;
 let at=0,match,malformed=false;
 while((match=expression.exec(source))){
  const parent=parents.at(-1);appendText(parent,source.slice(at,match.index));at=expression.lastIndex;
  if(match[1]){const span=document.createElement('span');span.dataset.templateEffect=match[1];span.title='效果片段；关联随内容一起保存';parent.append(span);parents.push(span);continue;}
  if(match[0]==='</effect>'){if(parents.length>1&&parent.dataset.templateEffect)parents.pop();else{malformed=true;parent.append(document.createTextNode(match[0]));}continue;}
  if(match[0]==='<cost>'){if(parents.some(node=>node.dataset?.templateSection==='cost'))malformed=true;const span=document.createElement('span');span.dataset.templateSection='cost';span.title='描述分段；结构随内容一起保存';parent.append(span);parents.push(span);continue;}
  if(match[0]==='</cost>'){if(parents.length>1&&parent.dataset.templateSection==='cost')parents.pop();else{malformed=true;parent.append(document.createTextNode(match[0]));}continue;}
  const span=document.createElement('span');span.style.cssText='display:inline;white-space:inherit;background:#463b28;color:#ffdc91;border-radius:3px;padding:0 3px';
  if(match[5]){span.dataset.templateKeyword=match[5];span.dataset.templateKeywordMode=match[6];span.title='关键词；修改后需生成校验';span.textContent=match[6]==='default'?`{${decode(match[7])}}`:`[${decode(match[7])}]`;}
  else{const id=match[2]??match[3],inputPending=match[4]!==undefined;const text=inputPending?decode(match[4]):`缺可读源文：${id}`;span.dataset.templateRef=id;span.dataset.templateOriginal=text;span.dataset.templatePending=String(inputPending);if(!inputPending)span.dataset.templateUnresolvedRaw=match[0];span.title=`来源：${id}${inputPending?'；待生成校验':''}`;span.textContent=`<${text}>`;}
  parent.append(span);
 }
 appendText(parents.at(-1),source.slice(at));
 // Invalid unfinished boundaries stay visible and editable, never auto-repaired.
 if(malformed||parents.length>1)return document.createTextNode(source);
 return root;
}

export function serializeTemplateNodes(root){
 const walk=node=>{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
  if(!(node instanceof HTMLElement))return '';
  if(node.dataset.templateCutEmpty==='true'&&!node.textContent)return '';
  if(node.dataset.templateLiteral!==undefined)return node.textContent===node.dataset.templateLiteralDisplay?node.dataset.templateLiteral:escape(node.textContent??'');
  if(node.dataset.templateKeyword)return keywordSourceFromDisplay(node.dataset.templateKeyword,node.dataset.templateKeywordMode,node.textContent??'');
  const id=node.dataset.templateRef;
  if(id){const input=(node.textContent??'').replace(/^<|>$/g,'');if(node.dataset.templateUnresolvedRaw&&node.dataset.templateOriginal===input)return node.dataset.templateUnresolvedRaw;return `<value ref="${id}">${escape(input)}</value>`;}
  if(node.tagName==='BR')return '\n';
  const children=Array.from(node.childNodes).map(walk).join('');
  if(node.dataset.templateEffect)return `<effect ref="${node.dataset.templateEffect}">${children}</effect>`;
  if(node.dataset.templateSection==='cost')return `<cost>${children}</cost>`;
  return node.tagName==='DIV'&&node!==root?'\n'+children:children;
 };
 return Array.from(root.childNodes).map(walk).join('');
}

/** Partial semantic containers cannot be copied out with silently lost scope. */
export function selectionSplitsEffect(root,range){
 return Array.from(root.querySelectorAll(templateScopeSelector)).some(node=>{
  if(!range.intersectsNode(node))return false;
  const whole=document.createRange();whole.selectNodeContents(node);
  if(range.compareBoundaryPoints(Range.START_TO_START,whole)>0){const before=whole.cloneRange();before.setEnd(range.startContainer,range.startOffset);if(before.toString().length)return true;}
  if(range.compareBoundaryPoints(Range.END_TO_END,whole)<0){const after=whole.cloneRange();after.setStart(range.endContainer,range.endOffset);if(after.toString().length)return true;}
  return false;
 });
}

export function templateSelectionSource(root,range){
 const common=range.commonAncestorContainer instanceof Element?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
 const literal=common?.closest('[data-template-literal]');
 if(literal&&root.contains(literal))return escape(range.toString());
 const container=document.createElement('div');container.append(range.cloneContents());return serializeTemplateNodes(container);
}
