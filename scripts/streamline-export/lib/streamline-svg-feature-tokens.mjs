function parseViewBox(svgText) {
  const match = String(svgText ?? "").match(/viewBox\s*=\s*["']\s*([0-9.\-]+)\s+([0-9.\-]+)\s+([0-9.\-]+)\s+([0-9.\-]+)\s*["']/i);
  if (!match) {
    return null;
  }
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  return { width, height };
}

function classifyViewBoxShape(viewBox) {
  if (!viewBox) {
    return null;
  }
  if (viewBox.width === viewBox.height) {
    return "viewbox:square";
  }
  return viewBox.width > viewBox.height ? "viewbox:landscape" : "viewbox:portrait";
}

function countElements(svgText, tagName) {
  const matches = String(svgText ?? "").match(new RegExp(`<${tagName}\\b`, "gi"));
  return matches?.length ?? 0;
}

function bucketCount(count) {
  if (count >= 3) {
    return "3+";
  }
  return String(Math.max(0, count));
}

export function extractSvgFeatureTokens(svgText) {
  const source = String(svgText ?? "");
  const tokens = [];
  const shapeToken = classifyViewBoxShape(parseViewBox(source));
  if (shapeToken) {
    tokens.push(shapeToken);
  }

  const elementNames = ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"];
  let nodeCount = 0;
  for (const elementName of elementNames) {
    const count = countElements(source, elementName);
    if (count > 0) {
      tokens.push(`element:${elementName}`);
      nodeCount += count;
    }
  }

  if (/fill\s*=\s*["'](?!none\b)/i.test(source)) {
    tokens.push("paint:fill");
  }
  if (/stroke\s*=\s*["'][^"']+/i.test(source)) {
    tokens.push("paint:stroke");
  }

  tokens.push(`path-count:${bucketCount(countElements(source, "path"))}`);
  tokens.push(`node-count:${bucketCount(nodeCount)}`);

  return tokens;
}
