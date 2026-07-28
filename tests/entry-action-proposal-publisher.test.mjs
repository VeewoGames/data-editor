import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { publishEntryActionProposal } from "../src/entry-action-proposal-publisher.mjs";
const proposal = { version: 1, runId: "10000000-0000-4000-8000-000000000001", actionId: "recheck", sourcePath: "fixtures/items.json", canonicalFileKey: "a".repeat(64), collectionPath: "items", rowId: "entry", baseDocumentEtag: "\"doc\"", automationProfileEtag: "\"profile\"", authorityDigest: "b".repeat(64), fencingToken: 1, change: { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" }, summary: "rename" };
test("proposal publishes atomically only after success and validation", async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),"proposal-")); try { const result=await publishEntryActionProposal({directory:root,runId:proposal.runId,exitCode:0,proposal}); assert.deepEqual(JSON.parse(await readFile(result.path,"utf8")),proposal); } finally { await rm(root,{recursive:true,force:true}); }
});
test("failure or schema errors leave no proposal", async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),"proposal-")); try { await assert.rejects(()=>publishEntryActionProposal({directory:root,runId:proposal.runId,exitCode:1,proposal})); await assert.rejects(()=>stat(path.join(root,`${proposal.runId}.proposal.json`))); } finally { await rm(root,{recursive:true,force:true}); }
});
