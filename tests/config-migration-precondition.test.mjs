import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadViewConfig,saveViewConfig} from '../src/view-config.mjs';
import {loadSharedViews,saveSharedViews} from '../src/shared-views.mjs';
import {loadViewProfile,saveViewProfile} from '../src/view-profile.mjs';

for(const kind of ['view','shared','profile'])test(`path migration refuses a changed ${kind} configuration preimage`,async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'data-editor-migration-cas-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const load=()=>kind==='view'?loadViewConfig(root):kind==='shared'?loadSharedViews(root):loadViewProfile(root,'tester');
 const save=(value,options)=>kind==='view'?saveViewConfig(root,value,options):kind==='shared'?saveSharedViews(root,value,options):saveViewProfile(root,'tester',value,options);
 const before=await load();
 const latest=kind==='view'?{...before,titleFields:{'data/current.json:$':'title'}}:kind==='shared'?{collections:{'data/current.json:$':{defaultViewId:'all',items:[{kind:'view',view:{id:'all',name:'Other window',type:'table'}}]}}}:{...before,sidebarWidth:381};
 await save(latest);const expected=await load();
 await assert.rejects(save(before,{expected:before}),{code:'CONFIG_PREIMAGE_CHANGED'});
 assert.deepEqual(await load(),expected);
 await save(expected,{expected});assert.deepEqual(await load(),expected);
});
