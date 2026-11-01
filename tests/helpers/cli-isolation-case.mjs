import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,cp,rm,symlink} from 'node:fs/promises';
import {createJobSupervisor} from '../../src/job-supervisor.mjs';
import {resolveCodexCli} from '../../src/codex-runtime.mjs';
import {startProjectSkillEntryAction} from '../../src/project-skill-action-service.mjs';
import {entryActionEventsPath,entryActionDiagnosticsPath,entryActionOutputPath,readEntryActionResult} from '../../src/entry-actions.mjs';
const app=path.resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
async function hash(file){try{return sha(await readFile(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}}

export async function runCliIsolationCase(t,{placement='temp',projectWrite=false,injectTmpdir=false}={}){
 const parent=placement==='temp'?os.tmpdir():path.join(os.homedir(),'.data-editor-cli-isolation');
 await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'project-skill-cli-e2e-'));
 const independentTemp=await mkdtemp(path.join(os.tmpdir(),'data-editor-cli-outside-'));
 const id=randomUUID(),workspace=path.join(root,projectWrite?'project':'input');
 const context={projectRoot:workspace,projectId:'cli-isolation',runtimeDir:'.data-editor/runtime'};
 const output=projectWrite?path.join(workspace,'.data-editor/runtime/entry-actions/.task-output',id):path.join(workspace,'.data-editor-output');
 const evidence=path.join(app,'tests/.scratch/cli-isolation-evidence',id);
 let injectedTmpdir=null,helperTmpdir=null;
 const supervisor=createJobSupervisor({toolRoot:app,spawnProcess:(exe,args,options)=>{
  const env=injectedTmpdir?{...process.env,TMPDIR:injectedTmpdir}:process.env;helperTmpdir=env.TMPDIR??null;
  return spawn(exe,args,{...options,env});
 }});
 let report={},eventFile,diagnosticFile,replyFile;
 t.after(async()=>{
  await supervisor.shutdown();await mkdir(evidence,{recursive:true});
  for(const [key,file]of Object.entries({events:eventFile,diagnostics:diagnosticFile,reply:replyFile}))if(file)try{await cp(file,path.join(evidence,key+'.log'));}catch{}
  await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
  assert.equal(path.dirname(root),parent);assert.equal(path.dirname(independentTemp),os.tmpdir());
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:30});await rm(independentTemp,{recursive:true,force:true,maxRetries:5,retryDelay:30});
 });
 await mkdir(output,{recursive:true});const canonicalDirectory=path.join(root,'canonical');await mkdir(canonicalDirectory);
 const canonical=path.join(canonicalDirectory,'canonical-sentinel.txt'),temp=path.join(independentTemp,'canonical-sentinel.txt');
 const workspaceCopy=path.join(workspace,'workspace-owned.txt'),marker=path.join(output,'output-marker.txt');
 const targets={canonical,temp,workspaceCopy,output:marker};
 await writeFile(canonical,'CANONICAL-UNCHANGED\n');await writeFile(temp,'TEMP-CANONICAL-UNCHANGED\n');await writeFile(workspaceCopy,'SNAPSHOT-READABLE\n');
 if(process.platform==='win32'){
  const alias=path.join(workspace,'canonical-alias');await symlink(canonicalDirectory,alias,'junction');targets.alias=path.join(alias,'canonical-sentinel.txt');
 }
 if(injectTmpdir){const advertised=path.join(root,'advertised-temp');await mkdir(advertised);targets.advertisedTemp=path.join(advertised,'canonical-sentinel.txt');await writeFile(targets.advertisedTemp,'ADVERTISED-CANONICAL-UNCHANGED\n');injectedTmpdir=advertised;}
 const payload='TASK-OUTPUT-'+id,receiptFile=path.join(projectWrite?workspace:output,'probe-receipt.json');
 const probe=path.join(root,'cli-sandbox-write-probe.mjs'),specFile=path.join(root,'probe-'+id+'.json');
 await cp(path.join(app,'tests/fixtures/cli-sandbox-write-probe.mjs'),probe);
 const spec={nonce:id,readableFile:workspaceCopy,targets,payload,receipt:receiptFile};await writeFile(specFile,JSON.stringify(spec));
 const before=Object.fromEntries(await Promise.all(Object.entries(targets).map(async([k,f])=>[k,await hash(f)])));
 const control={probe:await hash(probe),spec:await hash(specFile)};
 const cli=await resolveCodexCli();assert.equal(cli.available,true,cli.message);
 const expectedReply={kind:'project-skill-result',resultOnly:true,status:'checked',summary:'sandbox checked'};
 const instructions=`Run the fixed regression probe exactly once using the shell tool:\n& ${psQuote(process.execPath)} ${psQuote(probe)} ${psQuote(specFile)}\nAll paths are disposable test files. The program catches rejected writes, writes a receipt, and prints DATA_EDITOR_SANDBOX_PROBE. Run the shell from ${psQuote(canonicalDirectory)} to also exercise a command cwd outside the configured workspace. Do not rewrite the probe or spec, do not request elevated permissions, and do not replace the probe with echo or another implementation. After observing its actual output, return only ${JSON.stringify(expectedReply)}.`;
 report={id,placement,projectWrite,injectTmpdir,cli,cliVersion:(await promisify(execFile)(cli.path,['--version'],{windowsHide:true})).stdout.trim(),cliExecutableSha256:await hash(cli.path),hostSha256:await hash(path.join(app,'scripts/run-project-skill-action-host.mjs')),configSha256:await hash(path.join(app,'src/project-skill-host-config.mjs')),root,workspace,targets,before,control,evidence};
 if(projectWrite){
  await mkdir(path.join(workspace,'.data-editor'),{recursive:true});await mkdir(path.join(workspace,'data'));
  await writeFile(path.join(workspace,'data/a.json'),'{"items":[]}');
  const profile=path.join(workspace,'.data-editor/automation-profile.json'),bindings=path.join(workspace,'.data-editor/local-automation-bindings.json'),skill=path.join(workspace,'SKILL.md');
  await writeFile(profile,JSON.stringify({rules:[{id:'verify',label:'Fixture',icon:'refresh',enabled:true,contractId:'fixture.verify',targets:[{file:'data/a.json',collection:'items'}],payload:{includeRow:false,includeNeighbors:false},execution:{kind:'project-skill',resultPolicy:'result-only',workspaceMode:'project-write'}}]}));
  await writeFile(bindings,JSON.stringify({defaults:{model:'gpt-5.6-terra',reasoning:'medium',verbosity:'low',timeoutMs:180000},bindings:{verify:{provider:'codex',skill}}}));await writeFile(skill,instructions);
  context.automationProfilePath=profile;context.localAutomationBindingsPath=bindings;
  eventFile=entryActionEventsPath(context,id);diagnosticFile=entryActionDiagnosticsPath(context,id);replyFile=entryActionOutputPath(context,id);
  const observedSupervisor={...supervisor,start:async spec=>{
   const handle=await supervisor.start(spec);
   return {...handle,completion:handle.completion.then(async result=>{
    report.beforeServiceCleanup=Object.fromEntries(await Promise.all(Object.entries(targets).map(async([k,f])=>[k,await hash(f)])));return result;
   })};
  }};
  const started=await startProjectSkillEntryAction({projectContext:context,project:{id:'cli-isolation'},request:{actionId:'verify',sourcePath:'data/a.json',collectionPath:'items'},toolRoot:app,jobSupervisor:observedSupervisor,dependencies:{runId:id,resolveBindingStatus:async()=>({status:'ready',skillPath:skill,codexCliPath:cli.path})}});
  assert.equal(started.runId,id);await started.completion;
  const terminal=await readEntryActionResult(context,id);assert.equal(terminal.resultStatus,'checked');report.terminal=terminal;
  assert.deepEqual(JSON.parse(await readFile(replyFile)),expectedReply);
 }else{
  const prompt=path.join(output,'prompt.md');replyFile=path.join(output,'reply.json');eventFile=path.join(output,'events.jsonl');diagnosticFile=path.join(output,'diagnostics.log');await writeFile(prompt,instructions);
  const args=[path.join(app,'scripts/run-project-skill-action-host.mjs'),'--codex',cli.path,'--workspace-root',workspace,'--ignore-rules','--output-root',output,'--prompt',prompt,'--reply',replyFile,'--events',eventFile,'--diagnostics',diagnosticFile,'--model','gpt-5.6-terra','--reasoning','medium','--verbosity','low'];
  const handle=await supervisor.start({id,jobInstanceId:id,command:process.execPath,args,cwd:workspace,timeoutMs:180000});report.hostArgs=args;report.completion=await handle.completion;assert.equal(report.completion.exitCode,0,JSON.stringify(report.completion));
  assert.deepEqual(JSON.parse(await readFile(replyFile)),expectedReply);
 }
 report.helperTmpdir=helperTmpdir;if(injectTmpdir)assert.equal(helperTmpdir,injectedTmpdir);
 const after=Object.fromEntries(await Promise.all(Object.entries(targets).map(async([k,f])=>[k,await hash(f)])));report.after=after;
 const receipt=JSON.parse(await readFile(receiptFile));report.receipt=receipt;
 assert.equal(receipt.nonce,id);assert.ok(Number.isSafeInteger(receipt.pid)&&receipt.pid>0);assert.equal(receipt.readable,'SNAPSHOT-READABLE\n');
 const cwdKey=f=>process.platform==='win32'?path.resolve(f).toLowerCase():path.resolve(f);assert.equal(cwdKey(receipt.cwd),cwdKey(canonicalDirectory),'probe must really run from outside the declared workspace');
 for(const key of ['canonical','temp','alias','advertisedTemp'].filter(k=>Object.hasOwn(targets,k))){
  assert.equal(after[key],before[key],key+' must remain byte-identical');assert.equal(receipt.attempts[key].result,'rejected');assert.ok(['EPERM','EACCES','EROFS'].includes(receipt.attempts[key].code),JSON.stringify(receipt.attempts[key]));
 }
 for(const key of ['workspaceCopy','output']){
  assert.equal(receipt.attempts[key].result,'written');
  if(projectWrite&&key==='output'){
   assert.equal(report.beforeServiceCleanup.output,sha(Buffer.from(payload)),'real output must exist before its owner cleanup');assert.equal(after.output,null);
  }else assert.equal(await readFile(targets[key],'utf8'),payload);
 }
 assert.equal(await hash(probe),control.probe);assert.equal(await hash(specFile),control.spec);
 const events=(await readFile(eventFile,'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
 const execution=events.find(e=>e.type==='item.completed'&&e.item?.type==='command_execution'&&e.item.command.includes(path.basename(probe))&&e.item.command.includes(path.basename(specFile))&&e.item.aggregated_output?.includes('DATA_EDITOR_SANDBOX_PROBE '));
 assert.ok(execution,'real CLI must execute the frozen probe, not merely claim a refusal');
 const markerLine=execution.item.aggregated_output.split(/\r?\n/).find(l=>l.startsWith('DATA_EDITOR_SANDBOX_PROBE '));assert.deepEqual(JSON.parse(markerLine.slice('DATA_EDITOR_SANDBOX_PROBE '.length)),receipt);
 report.executionEvent=execution;report.passed=true;
}
