# Entry-action proposal-only success fixture v2

Do not run commands and do not write files. Return exactly the supplied JSON proposal, without prose or Markdown fences. The `runId` placeholder is replaced by the test harness.

```json
{"version":2,"runId":"{{RUN_ID}}","actionId":"fixture-rename","sourcePath":"data/items.json","canonicalFileKey":"{{CANONICAL_FILE_KEY}}","collectionPath":"$","rowId":"entry","baseDocumentEtag":{{BASE_DOCUMENT_ETAG}},"automationProfileEtag":{{AUTOMATION_PROFILE_ETAG}},"authorityDigest":"{{AUTHORITY_DIGEST}}","fencingToken":1,"changes":[{"field":"name","beforeExists":true,"before":"Alpha","afterExists":true,"after":"Beta"}],"textArtifact":null,"summary":"fixture rename"}
```
