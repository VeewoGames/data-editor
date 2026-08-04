import { createHash } from "node:crypto";

/** Stable digest for pre-promotion optimistic target authority. */
export function rowDigest(row) {
  return createHash("sha256").update(stableJson(row)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
