import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {readInlineTemplateDefinitions} from '../src/inline-template-context.mjs';
import {projectTemplateSearchRow,readableTemplateText,isTemplateProtectedField} from '../src/detail/inline-template-text.mjs';
import {runSearch} from '../src/view/search-engine.mjs';
import {buildTableColumnModels} from '../src/table/table-column-models.mjs';
import {buildTableColumnModelsSignature} from '../src/table/table-column-signatures.mjs';
test('nested source is a text column; public declaration never exposes command and unsafe languages are rejected',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'inline-fields-'));try{
  assert.deepEqual(await readInlineTemplateDefinitions({projectRoot:dir}),{version:1,templates:[]});await mkdir(path.join(dir,'.data-editor'));
  const file=path.join(dir,'.data-editor','inline-template-config.json');const item={file:'rows.json',collection:'rows',field:'copy',inspectCommand:{path:'private.mjs',args:['--secret-flag']},presentation:{label:'描述',languages:[{key:'zh_CN',label:'中文'}],tableLanguage:'zh_CN',advancedFields:['published']}};
  await writeFile(file,JSON.stringify({version:1,templates:[item]}));const result=await readInlineTemplateDefinitions({projectRoot:dir});assert.equal(result.templates[0].label,'描述');assert(!JSON.stringify(result).includes('private.mjs'));assert(!JSON.stringify(result).includes('secret-flag'));
  item.presentation.languages.push({key:'__proto__',label:'bad'});await writeFile(file,JSON.stringify({version:1,templates:[item]}));await assert.rejects(()=>readInlineTemplateDefinitions({projectRoot:dir}),/CONFIG_INVALID/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('search sees readable nested body and same-source formula without writing projected text back',()=>{
 const source={__entry_id:'a',copy:{zh_CN:'造成 <value ref="damage">140% 攻击力</value> 物理伤害。',en:'Deal <value ref="damage">140% Attack Damage</value> damage.'},other:{keep:true}};const before=structuredClone(source);
 const definitions=[{field:'copy'}];const contexts={copy:{zh_CN:{damage:{label:'140% 攻击力'}},en:{damage:{label:'140% Attack Damage'}}}};
 const projected=projectTemplateSearchRow(source,definitions,contexts);assert.equal(projected.copy,'造成 <140% 攻击力> 物理伤害。 Deal <140% Attack Damage> damage.');
 assert.deepEqual(runSearch({rows:[{rowId:'a',sourceOrder:0,row:projected}],query:'140% 攻击力'}).searchRowIds,['a']);assert.deepEqual(source,before);
 assert.equal(readableTemplateText('<value ref="damage">180% 攻击力</value>',{damage:{label:'140% 攻击力'}}),'<180% 攻击力>');
 assert.equal(readableTemplateText('<value ref="damage" />'),'<缺可读源文：damage>');
});
test('registered nested text mapping supersedes object inference while ordinary objects remain nested',()=>{
 const input={visibleFields:['copy','other'],rows:[{copy:{zh_CN:'hello'},other:{x:1}}],nestedFieldSet:new Set(['copy','other']),displayTypes:{},wrappedFields:new Set(),detectedTitleField:null,backlinkColumns:[],relationOptionsByField:{},relationConfigByField:{},fieldOptions:{},selectOptions:{},getColumnWidth:()=>320};
 const models=buildTableColumnModels({...input,textTemplateFields:['copy']});assert.equal(models[0].baseDisplayType,'Text');assert.equal(models[0].isNested,false);assert.equal(models[0].isTextTemplate,true);assert.equal(models[0].capabilities.canChangeType,false);assert.equal(models[0].capabilities.canBePrimaryKey,false);assert.equal(models[1].isNested,true);
 assert.equal(isTemplateProtectedField({copy:{}},'formal',[{writePolicies:[{requiresFields:['copy'],fields:['formal']}]}]),true);assert.equal(isTemplateProtectedField({},'formal',[{writePolicies:[{requiresFields:['copy'],fields:['formal']}]}]),false);
 assert.notEqual(buildTableColumnModelsSignature({...input,widths:{},textEditable:false,textTemplateFields:['copy']}),buildTableColumnModelsSignature({...input,widths:{},textEditable:false}));
});
