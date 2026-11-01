import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildRelationLookupState } from "../src/model/relation-lookup.mjs";

test("buildRelationLookupState reuses the active model for same-file relations", async () => {
  const activeModel = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://items.json");
  let loadCount = 0;

  const result = await buildRelationLookupState({
    relations: {
      "memory://items.json:$:target_id": {
        targetFile: "memory://items.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    activeFilePath: "memory://items.json",
    activeModel,
    loadDocument: async () => {
      loadCount += 1;
      throw new Error("should not load current document");
    },
  });

  assert.equal(loadCount, 0);
  assert.deepEqual([...result.relationIndexes["memory://items.json:$:target_id"]], ["a", "b"]);
  assert.equal(result.relationOptions["memory://items.json:$:target_id"][0]?.label, "Alpha");
});

test("buildRelationLookupState reports unavailable candidates when target documents are missing", async () => {
  const result = await buildRelationLookupState({
    relations: {
      "memory://items.json:$:target_id": {
        targetFile: "memory://missing.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    loadDocument: async () => {
      throw new Error("missing");
    },
  });

  assert.equal(result.relationIndexes["memory://items.json:$:target_id"], null);
  assert.equal(result.relationOptions["memory://items.json:$:target_id"], undefined);
  assert.equal(result.errors.length,1);
});

test("buildRelationLookupState ignores relations from other source collections", async () => {
  const loadedPaths = [];

  const result = await buildRelationLookupState({
    relations: {
      "memory://traits.json:$:keyword_id": {
        targetFile: "memory://keywords.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
      "memory://prototypes.json:$:candidate_id": {
        targetFile: "memory://removed.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    sourceFilePath: "memory://traits.json",
    sourceCollectionPath: "$",
    loadDocument: async (path) => {
      loadedPaths.push(path);
      return buildDocumentModel([{ id: "kw-1", name: "Keyword" }], "json", path);
    },
  });

  assert.deepEqual(loadedPaths, ["memory://keywords.json"]);
  assert.ok(result.relationIndexes["memory://traits.json:$:keyword_id"] instanceof Set);
  assert.equal(Object.hasOwn(result.relationIndexes, "memory://prototypes.json:$:candidate_id"), false);
  assert.equal(Object.hasOwn(result.relationOptions, "memory://prototypes.json:$:candidate_id"), false);
});

test("same target file is read once per relation build and failures remain explicit",async()=>{
 let reads=0;const config={targetFile:'data/targets.json',targetCollection:'$',targetKey:'id',mode:'single',allowMissing:false,titleFields:['name']};
 const result=await buildRelationLookupState({relations:{'data/a.json:$:one':config,'data/a.json:$:two':config},sourceFilePath:'data/a.json',sourceCollectionPath:'$',loadDocument:async()=>{reads++;return buildDocumentModel([{id:'a',name:'A'}],'json');}});
 assert.equal(reads,1);assert.equal(result.relationOptions['data/a.json:$:one'][0].label,'A');
 const failed=await buildRelationLookupState({relations:{'data/a.json:$:one':config},loadDocument:async()=>{throw Error('broken source')}});
 assert.equal(failed.errors.length,1);assert.equal(failed.relationOptions['data/a.json:$:one'],undefined);
});
test('relation options belong to the exact target configuration scope',async()=>{
  const {relationLookupScope,relationLookupForScope}=await import('../src/model/relation-lookup.mjs');
  const a=relationLookupScope('project','data/a.json','$',{key:{targetFile:'data/old.json'}});
  const b=relationLookupScope('project','data/a.json','$',{key:{targetFile:'data/new.json'}});
  const state={scope:a,indexes:{key:new Set(['old'])},options:{key:[{value:'old'}]}};
  assert.deepEqual(relationLookupForScope(b,state),{indexes:{},options:{}});
  assert.equal(relationLookupForScope(a,state).options,state.options);
});
