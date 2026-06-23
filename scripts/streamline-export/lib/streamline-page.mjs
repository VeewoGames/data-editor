export function parseIconSlugFromUrl(iconUrl) {
  const match = String(iconUrl ?? "").match(/\/icons\/download\/([a-z0-9-]+)--/i);
  return match ? match[1].toLowerCase() : null;
}

function nodeQuery(node, selector) {
  return typeof node?.querySelector === "function" ? node.querySelector(selector) : null;
}

export function findCurrentIconSvgFromDocument(documentLike) {
  const previewRoot =
    nodeQuery(documentLike, '[data-sentry-component="EditionPanelPreviewSection"] [role="img"]') ??
    nodeQuery(documentLike, '[data-sentry-component="EditionPanelPreviewSection"]') ??
    null;
  if (!previewRoot) return null;

  const detailSvg = nodeQuery(previewRoot, "svg");

  if (!detailSvg) return null;
  return {
    ariaLabel: typeof previewRoot.getAttribute === "function" ? previewRoot.getAttribute("aria-label") : null,
    svgId: typeof detailSvg.getAttribute === "function" ? detailSvg.getAttribute("id") : null,
    svgOuterHTML: String(detailSvg.outerHTML ?? ""),
  };
}

export function buildFindCurrentIconSvgScript() {
  return `
    function findCurrentIconSvg() {
      const previewRoot =
        document.querySelector('[data-sentry-component="EditionPanelPreviewSection"] [role="img"]') ||
        document.querySelector('[data-sentry-component="EditionPanelPreviewSection"]') ||
        null;
      if (!previewRoot) return null;

      const detailSvg = previewRoot.querySelector?.('svg') || null;

      if (!detailSvg) return null;
      return {
        ariaLabel: previewRoot.getAttribute?.('aria-label') || null,
        svgId: detailSvg.getAttribute('id'),
        svgOuterHTML: detailSvg.outerHTML,
      };
    }
  `;
}
