import { fieldWritePolicyMatchesRow } from '../field-write-policy-match.mjs';
const decode=text=>text.replace(/&(amp|lt|gt|quot);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"'})[key]);
/** Editing a label must preserve its admitted identity until the project validates it. */
export function keywordSourceFromDisplay(id,mode,display){
 if(!/^[a-z][a-z0-9_]{0,63}$/.test(id)||!['default','alt'].includes(mode))throw new Error('INLINE_TEMPLATE_KEYWORD_IDENTITY_INVALID');
 const label=String(display).replace(/^[{\[]|[}\]]$/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 return `<kw id="${id}" mode="${mode}">${label}</kw>`;
}
export function readableTemplateText(source) {
 if(!balancedTemplateScopes(source))return String(source??'');
 return decode(String(source??'').replace(/<value ref="([a-z][a-z0-9_]{0,63})"\s*\/>|<value ref="([a-z][a-z0-9_]{0,63})">([^<>]+)<\/value>/g,(_,ref,pending,input)=>`<${input!==undefined?input:`缺可读源文：${ref}`}>`)
  .replace(/<kw id="([a-z][a-z0-9_]{0,63})" mode="(default|alt)">([^<>]+)<\/kw>/g,(_,id,mode,label)=>mode==='default'?`{${label}}`:`[${label}]`)
  .replace(/<effect ref="[a-z][a-z0-9_]{0,63}">|<\/effect>|<cost>|<\/cost>/g,''));
}
/** Search-only shallow copy. Never install this projection into document.root. */
export function projectTemplateSearchRow(row,definitions) {
 const next={...row};for(const definition of definitions){const value=row[definition.field];if(value&&typeof value==='object'&&!Array.isArray(value))next[definition.field]=Object.keys(value).filter(key=>typeof value[key]==='string').map(key=>readableTemplateText(value[key])).join(' ');}return next;
}

export function isTemplateProtectedField(row,field,definitions){
 return definitions.some(definition=>definition.writePolicies?.some(policy=>policy.fields.includes(field)&&fieldWritePolicyMatchesRow(policy,row)));
}

export function balancedTemplateScopes(source){
 const stack=[];for(const match of String(source).matchAll(/<effect ref="[a-z][a-z0-9_]{0,63}">|<\/effect>|<cost>|<\/cost>/g)){
  const tag=match[0];if(tag.startsWith('</')){if(stack.pop()!==tag.slice(2,-1))return false;}
  else {const kind=tag.startsWith('<effect ')?'effect':'cost';if(stack.includes(kind))return false;stack.push(kind);}
 }return stack.length===0;
}
export function literalTemplateSource(text){return String(text).replaceAll('&','&amp;').replace(/<\/?(?:value|kw|effect|cost)\b[^>]*>/g,tag=>tag.replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'));}
