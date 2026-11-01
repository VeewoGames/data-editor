// G4 planning-only inventory. Writes audit artifacts beside this file only.
import path from 'node:path';
import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='C:/Code/data-editor',night='C:/Code/Nocturnel',out=import.meta.dirname;
const sha=b=>createHash('sha256').update(b).digest('hex'),slash=p=>p.replaceAll('\\','/');
async function walk(dir,accept=()=>true){let rows=[];for(const e of await readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){const f=path.join(dir,e.name);if(e.isDirectory())rows.push(...await walk(f,accept));else if(accept(f))rows.push(f);}return rows;}
const md=f=>f.endsWith('.md'),truthRoot=path.join(root,'.claw/truth'),docsRoot=path.join(root,'docs');
const truthFiles=await walk(truthRoot,md),docFiles=(await walk(docsRoot,md)).filter(f=>!slash(f).includes('/2026-10-25-G4')&&!path.basename(f).includes('2026-10-25-G4'));
const texts=new Map();for(const f of [...truthFiles,...docFiles,path.join(root,'README.md'),path.join(root,'.claw/memory.md')])texts.set(f,(await readFile(f,'utf8')).replace(/^\uFEFF/,''));
const old=JSON.parse(await readFile(path.join(root,'.claw/tasks/2026-10-25/通用化G0G1清单核实与隔离验证/evidence/G0-知识归属与入引用清单.json')));
const prior=new Map(old.documents.map(d=>[d.relative,d]));
const terms=/nocturnel|夜曲|data\/(?:content\/)?(?:skills|traits|runes)\.json|skill_axe_throw|limit_candidate|limit-request/i;
function links(f,text){return [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m=>({text:m[0],target:m[1],line:text.slice(0,m.index).split('\n').length})).filter(m=>!/^(?:https?:|#|mailto:)/i.test(m.target)).map(m=>{const raw=m.target.replace(/^<|>$/g,'').split('#')[0];let resolved;try{resolved=decodeURIComponent(raw);}catch{resolved=raw;}return {...m,resolved:path.isAbsolute(resolved)?path.resolve(resolved):path.resolve(path.dirname(f),resolved)};});}
const documents=[];
for(const f of truthFiles){const text=texts.get(f),relative=slash(path.relative(truthRoot,f)),oldRow=prior.get(relative);if(!terms.test(text)&&!oldRow)continue;const bytes=await readFile(f);const rows=text.split(/\r?\n/);const incoming=[];for(const [other,t]of texts){if(other!==f&&(t.includes(path.basename(f))||t.includes(relative)))incoming.push(slash(path.relative(root,other)));}
 const outgoing=[];for(const l of links(f,text))outgoing.push({...l,exists:await stat(l.resolved).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})});
 const classification=oldRow?.kind??'retain-generic-contract-or-historical-evidence';
 documents.push({relative,path:f,title:rows.find(l=>l.startsWith('# '))??null,sha256:sha(bytes),size:bytes.length,previousSha256:oldRow?.sha256??null,changedSinceG0:oldRow?sha(bytes)!==oldRow.sha256:null,classification,incoming,outgoing,matches:rows.flatMap((text,i)=>terms.test(text)?[{line:i+1,text}]:[]),headings:rows.flatMap((text,i)=>/^#{1,3} /.test(text)?[{line:i+1,text}]:[])});
}
const configFiles=(await walk(path.join(night,'.data-editor'),f=>f.endsWith('.json'))).filter(f=>{const r=slash(path.relative(path.join(night,'.data-editor'),f));return !/^(?:runtime|history-evidence|entry-action-policy-migration-backups)\//.test(r);});
const configs=[];for(const f of configFiles){const bytes=await readFile(f);const r=slash(path.relative(night,f));let disposition='already-project-owned-retain-no-write';if(/\/(?:view-configs|local)\//.test(r))disposition='retain-private-no-copy';else if(r.includes('/backups/'))disposition='retain-backup-never-move';else if(r.includes('/publication-admission/')||r.endsWith('/historical-disposition-registration.json'))disposition='retain-admission-protection-never-write';configs.push({path:f,relative:r,sha256:sha(bytes),size:bytes.length,disposition});}
const productDocs=[];for(const f of docFiles){const text=texts.get(f);if(!terms.test(text))continue;const bytes=await readFile(f);productDocs.push({path:f,relative:slash(path.relative(root,f)),sha256:sha(bytes),matches:text.split(/\r?\n/).flatMap((text,i)=>terms.test(text)?[{line:i+1,text}]:[])});}
const count={};for(const d of documents)count[d.classification]=(count[d.classification]??0)+1;
const auxiliaryRecords=[];for(const f of await walk(docsRoot,f=>f.endsWith('.json'))){if(slash(f).startsWith(slash(out)+'/'))continue;const bytes=await readFile(f);if(/nocturnel|夜曲/i.test(bytes.toString('utf8')))auxiliaryRecords.push({path:f,relative:slash(path.relative(root,f)),sha256:sha(bytes),disposition:'retain-frozen-or-historical-record-no-rewrite'});}
const example=path.join(root,'examples/nocturnel/data-editor.project.json'),exampleBytes=await readFile(example);
const allTruthBaselines=[];for(const file of truthFiles)allTruthBaselines.push({path:file,sha256:sha(await readFile(file))});
const result={version:1,status:'planning-inventory-not-execution-authorization',capturedAt:new Date().toISOString(),scope:{truth:'all current truth-tree Markdown including ADR',documents:'all repository docs Markdown and JSON excluding this G4 output; historical docs are inventory only',references:'Markdown links plus literal source basenames in current truth/docs/README/.claw/memory.md; frozen task/archive references preserved by same-path historical stubs, no bulk rewrite',excluded:'frozen tasks/archive/raw proofs/runtime/canonical plan/job/db; no migration writes'},previousTruthCount:old.scannedDocuments,scannedTruthCount:truthFiles.length,matchedTruthCount:documents.length,classificationCounts:count,allTruthBaselines,documents,productDocs,auxiliaryRecords,projectConfigurations:configs,legacyExample:{path:example,sha256:sha(exampleBytes),size:exampleBytes.length,disposition:'G5-candidate-only; unused-old-schema-never-copy-to-live-project'}};
await writeFile(path.join(out,'G4知识配置现状与引用清单.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(path.join(out,'G4知识配置现状与引用清单.sha256'),sha(Buffer.from(JSON.stringify(result,null,2)+'\n'))+'\n');
console.log(JSON.stringify({scannedTruth:truthFiles.length,matchedTruth:documents.length,count,productDocs:productDocs.length,projectConfigs:configs.length,newMatches:documents.filter(d=>d.classification==='new-match-review-required').map(d=>d.relative)}));
