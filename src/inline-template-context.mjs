import { loadFieldWritePolicy } from './field-write-policy.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { commandError } from './project-command-snapshot.mjs';

/** Public presentation only: project commands remain server-owned. */
export async function readInlineTemplateDefinitions(context) {
  let config;
  try { config=JSON.parse(await readFile(path.join(context.projectRoot,'.data-editor','inline-template-config.json'),'utf8')); }
  catch(error) { if(error.code==='ENOENT') return {version:1,templates:[]}; throw error; }
  if(config?.version!==1||!Array.isArray(config.templates))throw commandError('INLINE_TEMPLATE_CONFIG_INVALID');
  const fieldPolicy=await loadFieldWritePolicy(context);
  const seen=new Set();
  const templates=config.templates.map(item=>{
    if(!item||typeof item!=="object")throw commandError("INLINE_TEMPLATE_CONFIG_INVALID");
    const presentation=item.presentation??{};
    const languages=presentation.languages??[];
    if(!item||typeof item.file!=='string'||typeof item.collection!=='string'||typeof item.field!=='string'||['__proto__','constructor','prototype'].includes(item.field)
      ||!Array.isArray(languages)||languages.some(x=>!x||typeof x.key!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(x.key)||typeof x.label!=='string')
      ||new Set(languages.map(x=>x.key)).size!==languages.length)throw commandError('INLINE_TEMPLATE_CONFIG_INVALID');
    if(presentation.tableLanguage&&!languages.some(x=>x.key===presentation.tableLanguage))throw commandError('INLINE_TEMPLATE_CONFIG_INVALID');
    const identity=JSON.stringify([item.file,item.collection,item.field]);if(seen.has(identity))throw commandError('INLINE_TEMPLATE_CONFIG_INVALID');seen.add(identity);
    return {file:item.file,collection:item.collection,field:item.field,label:typeof presentation.label==='string'?presentation.label:item.field,
      languages:languages.map(({key,label})=>({key,label})),tableLanguage:presentation.tableLanguage??languages[0]?.key??null,
      writePolicies:fieldPolicy.policies.filter(rule=>rule.file===item.file&&rule.collection===item.collection),
      advancedFields:Array.isArray(presentation.advancedFields)?presentation.advancedFields.filter(x=>typeof x==='string'):[]};
  });
  return {version:1,templates};
}
