/** Browser-compatible counterpart of row-digest.mjs for proposal admission. */
export async function rowDigestBrowser(row) {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持自动化条目校验。");
  const bytes = new TextEncoder().encode(stableJson(row));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
