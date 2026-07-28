# Entry-action proposal-only success fixture v1

Do not run commands and do not write files. Return exactly the supplied JSON proposal, without prose or Markdown fences. The `runId` placeholder is replaced by the test harness.

```json
{"version":1,"runId":"{{RUN_ID}}","actionId":"fixture-rename","sourcePath":"data/items.json","canonicalFileKey":"{{CANONICAL_FILE_KEY}}","collectionPath":"items","rowId":"entry","baseDocumentEtag":"\"fixture-document\"","automationProfileEtag":"\"fixture-profile\"","authorityDigest":"{{AUTHORITY_DIGEST}}","fencingToken":1,"change":{"field":"name","beforeExists":true,"before":"Alpha","afterExists":true,"after":"Beta"},"summary":"fixture rename"}
```
