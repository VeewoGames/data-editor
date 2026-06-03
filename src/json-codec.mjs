export function parseJson(text) {
  const data = JSON.parse(text);
  const rootKind = Array.isArray(data) ? "array" : typeof data;
  if (rootKind !== "array" && rootKind !== "object") {
    throw new Error(`Unsupported JSON root kind: ${rootKind}`);
  }
  return {
    format: "json",
    rootKind,
    data,
  };
}

export function serializeJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}
