import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFindCurrentIconSvgScript,
  findCurrentIconSvgFromDocument,
  parseIconSlugFromUrl,
} from "../../scripts/streamline-export/lib/streamline-page.mjs";

function createFakeNode({ textContent = "", attrs = {}, outerHTML = "", children = {} } = {}) {
  return {
    textContent,
    outerHTML,
    querySelector(selector) {
      return children[selector] ?? null;
    },
    getAttribute(name) {
      return attrs[name] ?? null;
    },
  };
}

test("parseIconSlugFromUrl extracts download slug", () => {
  assert.equal(
    parseIconSlugFromUrl("https://www.streamlinehq.com/icons/download/attachment-1--26582"),
    "attachment-1",
  );
});

test("find helper reads the preview section svg", () => {
  const detailSvg = createFakeNode({
    attrs: { id: "detail-svg" },
    outerHTML: '<svg id="detail-svg"><path d="M0 0" /></svg>',
  });
  const previewRoot = createFakeNode({
    attrs: { "aria-label": "Attachment 2 Icon from Micro Solid Set" },
    children: { svg: detailSvg },
  });
  const fakeDocument = {
    querySelector(selector) {
      return selector === '[data-sentry-component="EditionPanelPreviewSection"] [role="img"]'
        ? previewRoot
        : null;
    },
  };

  const result = findCurrentIconSvgFromDocument(fakeDocument);
  assert.equal(result.ariaLabel, "Attachment 2 Icon from Micro Solid Set");
  assert.equal(result.svgId, "detail-svg");
  assert.match(result.svgOuterHTML, /detail-svg/);
});

test("buildFindCurrentIconSvgScript exposes browser callable helper", () => {
  const script = buildFindCurrentIconSvgScript();
  assert.match(script, /function findCurrentIconSvg/);
  assert.match(script, /EditionPanelPreviewSection/);
  assert.match(script, /svgOuterHTML/);
});
