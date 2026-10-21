import test from 'node:test';import assert from 'node:assert/strict';
import {refreshCommandDocument} from '../src/editing/command-result-refresh.mjs';
test('late local author draft survives generation; formal result cannot be overwritten by next save',()=>{
 const base={rows:[{__entry_id:'x',sources:{zh:'<100%>'},formal:'old'}]};const local=structuredClone(base);local.rows[0].sources.zh='<180%>';
 const server=structuredClone(base);server.rows[0].sources.zh='<ref />';server.rows[0].formal='generated';
 const result=refreshCommandDocument(base,local,server,['formal']);assert(result.keptDraft);assert.equal(result.root.rows[0].sources.zh,'<180%>');assert.equal(result.root.rows[0].formal,'generated');
 assert.deepEqual(refreshCommandDocument(base,base,server,['formal']).root,server);
});
test('structural conflicts preserve original draft instead of guessing merge',()=>{
 const base=[{__entry_id:'a'}];assert.throws(()=>refreshCommandDocument(base,[],[{__entry_id:'b'}]),/STRUCTURAL_CONFLICT/);assert.equal(base.length,1);
});
