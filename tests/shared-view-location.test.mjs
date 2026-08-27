import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSharedViewUrl,
  clearSharedViewUrlLocation,
  readSharedViewUrlLocation,
  writeProjectUrlLocation,
  writeSharedViewUrlLocation,
} from "../src/shared-view-location.mjs";

test("buildSharedViewUrl writes project, file, collection and view into query params", () => {
  const url = buildSharedViewUrl("http://127.0.0.1:8787/#view=legacy", {
    projectId: "project-alpha",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "damage",
  });

  assert.equal(
    url,
    "http://127.0.0.1:8787/?projectId=project-alpha&path=data%2Frunes.json&collectionPath=%24&viewId=damage",
  );
});

test("readSharedViewUrlLocation normalizes missing params to null and keeps default collection path", () => {
  const location = readSharedViewUrlLocation(new URL("http://127.0.0.1:8787/?path=data%2Frunes.json"));

  assert.deepEqual(location, {
    projectId: null,
    path: "data/runes.json",
    collectionPath: "$",
    viewId: null,
  });
});

test("writeSharedViewUrlLocation overwrites stale params and clearSharedViewUrlLocation removes them", () => {
  const written = writeSharedViewUrlLocation(
    new URL("http://127.0.0.1:8787/?projectId=old&path=old.json&collectionPath=%24&viewId=old#view=legacy"),
    {
      projectId: "project-beta",
      path: "data/skills.json",
      collectionPath: "$.items",
      viewId: "support",
    },
  );

  assert.equal(
    written.toString(),
    "http://127.0.0.1:8787/?projectId=project-beta&path=data%2Fskills.json&collectionPath=%24.items&viewId=support#view=legacy",
  );

  const cleared = clearSharedViewUrlLocation(written);
  assert.equal(cleared.toString(), "http://127.0.0.1:8787/#view=legacy");
});

test("writeProjectUrlLocation keeps the project owner and clears stale shared-view state", () => {
  const url = writeProjectUrlLocation(
    new URL("http://127.0.0.1:8787/?projectId=old&path=data%2Fold.json&collectionPath=%24&viewId=old#view=legacy"),
    "project-beta",
  );

  assert.equal(url.toString(), "http://127.0.0.1:8787/?projectId=project-beta#view=legacy");
});
