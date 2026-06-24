import test from "node:test";
import assert from "node:assert/strict";
import { extractSvgFeatureTokens } from "../../scripts/streamline-export/lib/streamline-svg-feature-tokens.mjs";

test("extractSvgFeatureTokens captures coarse structure tokens from svg text", () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">',
    '<rect x="1" y="1" width="10" height="8" fill="#000"/>',
    '<circle cx="6" cy="6" r="2" stroke="#fff" fill="none"/>',
    "</svg>",
  ].join("");

  assert.deepEqual(extractSvgFeatureTokens(svg), [
    "viewbox:square",
    "element:rect",
    "element:circle",
    "paint:fill",
    "paint:stroke",
    "path-count:0",
    "node-count:2",
  ]);
});

test("extractSvgFeatureTokens buckets multiple paths", () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12">',
    '<path d="M0 0h3"/>',
    '<path d="M3 0h3"/>',
    '<path d="M6 0h3"/>',
    "</svg>",
  ].join("");

  assert.deepEqual(extractSvgFeatureTokens(svg), [
    "viewbox:landscape",
    "element:path",
    "path-count:3+",
    "node-count:3+",
  ]);
});
