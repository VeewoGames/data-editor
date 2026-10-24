import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldWritePolicyMatchesRow, canEditNestedField } from '../src/field-write-policy-match.mjs';
import { isTemplateProtectedField } from '../src/detail/inline-template-text.mjs';

const selected = { fields:['configuration'], requiresFields:['author'], rowSelector:{primaryKeyField:'__entry_id',values:['selected']} };
test('row-specific protection agrees in table and detail without locking unrelated rows', () => {
  for (const [row,expected] of [[{__entry_id:'selected',author:''},true],[{__entry_id:'other',author:''},false],[{author:''},false],[{__entry_id:'selected'},true]]) {
    assert.equal(fieldWritePolicyMatchesRow(selected,row),expected);
    assert.equal(isTemplateProtectedField(row,'configuration',[{writePolicies:[selected]}]),expected);
    assert.equal(isTemplateProtectedField(row,'author',[{writePolicies:[selected]}]),false);
  }
  assert.equal(fieldWritePolicyMatchesRow({requiresFields:['author']},{author:null}),true);
});
test('nested writes reject unknown policies, protected roots and callbacks from a previous row', () => {
  const row={__entry_id:'selected'},guard={row,ready:true,protectedFields:new Set(['configuration'])};
  let writes=0;
  const edit=(root,value)=>{if(canEditNestedField(guard,row,root))writes++;};
  edit('configuration',[]);assert.equal(writes,0);
  edit('editable',[]);assert.equal(writes,1);
  guard.ready=false;edit('editable',[]);assert.equal(writes,1);
  guard.ready=true;guard.row={__entry_id:'other'};edit('editable',[]);assert.equal(writes,1);
  assert.equal(canEditNestedField(null,row,'editable'),false);
});
