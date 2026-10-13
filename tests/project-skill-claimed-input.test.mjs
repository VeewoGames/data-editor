import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createProjectContext} from '../src/project-context.mjs';
import {startProjectSkillEntryAction} from '../src/project-skill-action-service.mjs';
import {entryActionHandoffPath} from '../src/entry-actions.mjs';

test('losing deterministic run cannot overwrite frozen input and original document guard still rejects drift',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'claimed-project-skill-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const context=createProjectContext({projectRoot:root,projectId:'claim-fixture',localAutomationBindingsPath:path.join(root,'.data-editor/bindings.json')});
  for(const dir of ['.data-editor','data','docs','.agents/skills/fixture'])await mkdir(path.join(root,dir),{recursive:true});
  await writeFile(path.join(root,'data/items.json'),JSON.stringify([{__entry_id:'row-1',slug:'alpha',value:1}]));
  await writeFile(path.join(root,'docs/alpha.md'),'# Original\n');
  await writeFile(path.join(root,'.data-editor/view-config.json'),JSON.stringify({primaryKeys:{'data/items.json:$':'slug'},documentFiles:{'data/items.json':{docRoot:'docs'}}}));
  await writeFile(path.join(root,'.agents/skills/fixture/SKILL.md'),'# Fixture\n');
  await writeFile(context.automationProfilePath,JSON.stringify({rules:[{id:'fixture',label:'fixture',enabled:true,icon:'refresh',targets:[{file:'data/items.json',collection:'$',textArtifact:{}}],payload:{includeRow:true,includeNeighbors:false},execution:{kind:'project-skill',resultPolicy:'proposal'},contractId:'fixture.v1'}]}));
  await writeFile(context.localAutomationBindingsPath,JSON.stringify({defaults:{},bindings:{fixture:{provider:'codex',skill:'fixture',enabled:true}}}));
  let finish;
  const jobSupervisor={async start(spec){await writeFile(spec.args[spec.args.indexOf('--reply')+1],JSON.stringify({kind:'project-skill-result',resultOnly:true,status:'no_changes',summary:'fixture'}));return{completion:new Promise(resolve=>{finish=resolve;})};}};
  const input={projectContext:context,project:{id:context.projectId},request:{actionId:'fixture',sourcePath:'data/items.json',collectionPath:'$',rowId:'row-1'},toolRoot:process.cwd(),jobSupervisor,dependencies:{followupRunId:'12345678-0000-4000-8000-000000000001',resolveBindingStatus:async()=>({status:'ready',skillPath:path.join(root,'.agents/skills/fixture/SKILL.md'),codexCliPath:process.execPath})}};
  const first=await startProjectSkillEntryAction(input);
  const frozen=await readFile(entryActionHandoffPath(context,first.runId),'utf8');
  await writeFile(path.join(root,'docs/alpha.md'),'# Changed\n');
  await assert.rejects(startProjectSkillEntryAction(input),{code:'EEXIST'});
  assert.equal(await readFile(entryActionHandoffPath(context,first.runId),'utf8'),frozen);
  // The first supervisor is started asynchronously after input preparation.
  while(!finish)await new Promise(resolve=>setTimeout(resolve,1));
  const rejected=assert.rejects(first.completion,{code:'PROJECT_SKILL_DOCUMENT_STALE'});
  finish({exitCode:0,timedOut:false});await rejected;
});
