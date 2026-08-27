import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ViewTabs copy-link flow uses shared-view-location helper and App passes copy-link context", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const viewTabsSource = await readFile(new URL("../src/components/ViewTabs.tsx", import.meta.url), "utf8");
  const helperSource = await readFile(new URL("../src/shared-view-location.mjs", import.meta.url), "utf8");

  assert.match(viewTabsSource, /buildSharedViewUrl/);
  assert.match(viewTabsSource, /activeProjectId:\s*string \| null;/);
  assert.match(viewTabsSource, /selectedPath:\s*string \| null;/);
  assert.match(viewTabsSource, /collectionPath:\s*string;/);
  assert.match(viewTabsSource, /if \(!activeProjectId \|\| !selectedPath \|\| !collectionPath\) return;/);
  assert.match(viewTabsSource, /buildSharedViewUrl\(window\.location\.href,\s*\{/);
  assert.match(appSource, /activeProjectId=\{activeProjectId\}/);
  assert.match(appSource, /selectedPath=\{selectedPath\}/);
  assert.match(appSource, /collectionPath=\{collectionPath\}/);
  assert.match(helperSource, /projectId/);
  assert.match(helperSource, /collectionPath/);
  assert.match(helperSource, /viewId/);
});

test("App restores shared-view URLs from their project owner without changing the registry default", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /readSharedViewUrlLocation/);
  assert.match(appSource, /pendingSharedViewUrlLocationRef/);
  assert.match(appSource, /sharedViewUrlResolutionRef/);
  assert.match(appSource, /restoreProjectFromUrl/);
  assert.match(appSource, /writeProjectUrlLocation/);
  assert.doesNotMatch(appSource, /activateProject\(/);
  assert.match(appSource, /preferredViewId: pendingPreferredViewId/);
  assert.match(appSource, /updateSharedViewDraftState\(\{/);
  assert.match(appSource, /updatePageContextViewGrouping\(window\.localStorage, activeProjectId,/);
  assert.match(appSource, /invalidPath \|\| sharedViewUrlResolutionRef\.current\.invalidCollectionPath/);
  assert.match(appSource, /rewriteToCurrent: true, resolvedViewId: activeViewLayoutId/);
  assert.match(appSource, /window\.history\.replaceState\(null, "", url\.toString\(\)\)/);
});
