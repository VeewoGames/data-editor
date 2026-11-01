import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {readFile,mkdir,symlink} from 'node:fs/promises';import {createAuthorityFixture,assertFixtureLedgerUnchanged,assertMissing} from './helpers/authority-fixture.mjs';

test('protected configuration writers save profile, view config and shared views without an automation run',async t=>{
 const f=await createAuthorityFixture(t),profiles=await f.load('src/view-profile.mjs'),views=await f.load('src/view-config.mjs'),shared=await f.load('src/shared-views.mjs');
 await profiles.saveViewProfile(f.context,'User',{lastActiveViews:{'data/items.json:$':'all'}});
 assert.equal((await profiles.loadViewProfile(f.context,'User')).lastActiveViews['data/items.json:$'],'all');
 await views.saveViewConfig(f.context,{fields:{},primaryKeys:{},relations:{},documentFields:{},titleFields:{},backlinks:{}});
 await shared.saveSharedViews(f.context,{collections:{}});
 await assertFixtureLedgerUnchanged(f);await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),{code:'HISTORY_RUN_CLOSED'});
});

test('external profiles remain valid, but configuration scope has no other external or business write permission',async t=>{
 const f=await createAuthorityFixture(t),profiles=await f.load('src/view-profile.mjs'),external=path.join(f.directory,'profiles'),context={...f.context,userViewProfilesDir:external};
 await profiles.saveViewProfile(context,'User',{sidebarWidth:250});assert.equal((await profiles.loadViewProfile(context,'User')).sidebarWidth,250);
 const protectedBefore=await readFile(f.sourceFile),other=path.join(f.directory,'other.json');
 for(const target of [f.sourceFile,other,path.join(f.runtimeRoot,'unknown.json')])await assert.rejects(()=>f.mod.withHistoricalConfigurationSave(context,{kind:'view-profile',name:'User'},()=>f.atomic.atomicWrite(target,'{}')),{code:'HISTORY_CONFIGURATION_WRITESET_INVALID'});
 assert.deepEqual(await readFile(f.sourceFile),protectedBefore);await assertMissing(other);await assertFixtureLedgerUnchanged(f);
});

test('configuration admission rejects business destinations, path aliases and another protected project before effects',async t=>{
 const f=await createAuthorityFixture(t,{rootCount:2}),profiles=await f.load('src/view-profile.mjs');let reached=0;
 await assert.rejects(()=>f.mod.withHistoricalConfigurationSave({...f.context,sharedViewConfigPath:'data/items.json'},{kind:'view-config'},()=>reached++),{code:'HISTORY_CONFIGURATION_WRITESET_INVALID'});
 await assert.rejects(()=>profiles.saveViewProfile({...f.context,userViewProfilesDir:path.join(f.projects[1].root,'.data-editor/view-configs')},'User',{}),{code:'HISTORY_BINDING_INVALID'});
 const real=path.join(f.directory,'profiles-real'),alias=path.join(f.directory,'profiles-alias');await mkdir(real);await symlink(real,alias,'junction');
 await assert.rejects(()=>profiles.saveViewProfile({...f.context,userViewProfilesDir:alias},'User',{}),{code:'HISTORY_CONFIGURATION_ALIAS_REJECTED'});
 assert.equal(reached,0);await assertFixtureLedgerUnchanged(f);
});

test('configuration scope cannot be nested or used by a late continuation',async t=>{
 const f=await createAuthorityFixture(t),admit=operation=>f.mod.withHistoricalConfigurationSave(f.context,{kind:'view-profile',name:'User'},operation);
 for(const enter of [
  op=>admit(op),op=>f.mod.withHistoricalRun(f.context,['fresh-config-test'],op),
  op=>f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile:path.join(f.runtimeRoot,'commit-journal','config-test.json')},op),
  op=>f.mod.withHistoricalPublicationState(f.context,op),
 ])await assert.rejects(()=>enter(()=>admit(()=>{})),{code:'HISTORY_AUTHOR_SCOPE_ESCALATION'});
 let release,late;const gate=new Promise(resolve=>release=resolve);await admit(target=>{late=gate.then(()=>f.atomic.atomicWrite(target,'{}'));});release();await assert.rejects(late,{code:'HISTORY_AUTHOR_SCOPE_EXPIRED'});await assertFixtureLedgerUnchanged(f);
});

test('root data sources retain exact configuration namespaces and still reject business targets',async t=>{
 const f=await createAuthorityFixture(t),profiles=await f.load('src/view-profile.mjs'),views=await f.load('src/view-config.mjs'),shared=await f.load('src/shared-views.mjs');
 for(const source of [{id:'data',kind:'relative',path:'.'},{id:'data',kind:'absolute',path:f.root}]){
  const context={...f.context,dataSources:[source]};await profiles.saveViewProfile(context,'RootUser',{});await views.saveViewConfig(context,{});await shared.saveSharedViews(context,{collections:{}});
  await assert.rejects(()=>f.mod.withHistoricalConfigurationSave({...context,sharedViewConfigPath:'data/items.json'},{kind:'view-config'},()=>{}),{code:'HISTORY_CONFIGURATION_WRITESET_INVALID'});
 }await assertFixtureLedgerUnchanged(f);
});

test('protected configuration conflicts and failed writes leave prior bytes and ledger intact',async t=>{const f=await createAuthorityFixture(t),profiles=await f.load('src/view-profile.mjs');await profiles.saveViewProfile(f.context,'User',{sidebarWidth:210});const {target}=(await f.load('src/project-context.mjs')).resolveConfigurationSaveTarget(f.context,{kind:'view-profile',name:'User'}),before=await readFile(target);await assert.rejects(()=>profiles.saveViewProfile(f.context,'User',{sidebarWidth:250},{expected:{}}),{code:'CONFIG_PREIMAGE_CHANGED'});assert.deepEqual(await readFile(target),before);await assert.rejects(()=>f.mod.withHistoricalConfigurationSave(f.context,{kind:'view-profile',name:'User'},()=>{throw new Error('fixture disk failure');}),/fixture disk failure/);assert.deepEqual(await readFile(target),before);await assertFixtureLedgerUnchanged(f);});
