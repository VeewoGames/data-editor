import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=import.meta.dirname,root='C:/Code/data-editor',frozen=path.join(root,'.claw/tasks/2026-10-25/G3冻结207目标正式切换与生产验收');
const sha=b=>createHash('sha256').update(b).digest('hex'),key=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
const a=JSON.parse(await readFile(path.join(out,'G4知识配置现状与引用清单.json'))),p=JSON.parse(await readFile(path.join(out,'G4逐项承接映射与候选路径白名单.json')));
const g3=JSON.parse(await readFile(path.join(frozen,'evidence/G3-精确执行写集.json'))),g3Source=JSON.parse(await readFile(path.join(frozen,'evidence/G3-候选写集.json')));
const errors=[];async function hash(file){try{return sha(await readFile(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
for(const f of [...a.allTruthBaselines,...a.projectConfigurations,...p.readOnlyCurrentOwners,...a.productDocs,...a.auxiliaryRecords,a.legacyExample])if(await hash(f.path)!==f.sha256)errors.push('planning-source-drift:'+f.path);
for(const w of p.writes)if(await hash(w.target)!==w.beforeSha256)errors.push('proposed-before-drift:'+w.target);
const sets={g3Targets:new Set(g3.writes.map(w=>key(w.target))),g3Protected:new Set(g3Source.protectedFiles.map(f=>key(f.path))),g3Sources:new Set(g3.sourcePins.map(f=>key(f.file))),projectConfigs:new Set(a.projectConfigurations.map(f=>key(f.path))),currentOwners:new Set(p.readOnlyCurrentOwners.map(f=>key(f.path)))};
const intersections={};for(const [name,set]of Object.entries(sets)){intersections[name]=p.writes.filter(w=>set.has(key(w.target))).map(w=>w.target);if(intersections[name].length)errors.push('proposed-write-overlap:'+name);}
if(p.totalTargets!==40||p.editorTargets!==21||p.nightTargets!==19||p.delete!==0||p.approved!==false)errors.push('proposal-scope-or-approval-invalid');
const result={at:new Date().toISOString(),verified:errors.length===0,originalTruthFilesUnchanged:a.allTruthBaselines.length,projectConfigFilesUnchanged:a.projectConfigurations.length,currentNightOwnersUnchanged:p.readOnlyCurrentOwners.length,proposedTargets:p.totalTargets,create:p.create,replace:p.replace,delete:p.delete,intersections,sourceInventoryDigest:sha(await readFile(path.join(out,'G4知识配置现状与引用清单.json'))),proposalDigest:sha(await readFile(path.join(out,'G4逐项承接映射与候选路径白名单.json'))),errors};
await writeFile(path.join(out,'规划边界与保护集合不相交核验.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(errors.length)process.exitCode=1;
