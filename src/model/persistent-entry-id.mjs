import { getRows } from "../document-model.mjs";
import { attachRowId, readRowId } from "./row-id.mjs";

export const persistentEntryIdField = "__entry_id";

const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function isPersistentEntryIdField(fieldName) {
  return String(fieldName ?? "") === persistentEntryIdField;
}

export function readPersistentEntryId(row) {
  if (!isPlainObject(row)) return null;
  const value = row[persistentEntryIdField];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function ensurePersistentEntryId(row) {
  if (!isPlainObject(row)) return { changed: false, value: null };
  const existing = readPersistentEntryId(row);
  const value = existing ?? generatePersistentEntryId();
  if (!existing) row[persistentEntryIdField] = value;
  attachRowId(row, value);
  return { changed: !existing, value };
}

export function ensurePersistentEntryIds(model) {
  if (!model?.collections?.length) return { changed: false, changedCount: 0 };
  let changedCount = 0;
  for (const collection of model.collections) {
    if (model.rootCollectionKind === "record-map" && collection.path === "$") continue;
    const rows = getRows(model, collection.path);
    for (const row of rows) {
      const result = ensurePersistentEntryId(row);
      if (result.changed) changedCount += 1;
    }
  }
  return { changed: changedCount > 0, changedCount };
}

export function buildVisibleFieldList(fields) {
  return fields.filter((fieldName) => !isPersistentEntryIdField(fieldName));
}

export function generatePersistentEntryId(now = Date.now()) {
  const timeChars = encodeBase32(now, 10);
  const randomBytes = new Uint8Array(16);
  fillRandomValues(randomBytes);
  const randomChars = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of randomBytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && randomChars.length < 16) {
      bits -= 5;
      randomChars.push(crockfordBase32[(buffer >>> bits) & 31]);
    }
    if (randomChars.length >= 16) break;
  }
  while (randomChars.length < 16) {
    randomChars.push(crockfordBase32[Math.floor(Math.random() * 32)]);
  }
  return `${timeChars}${randomChars.join("")}`;
}

function encodeBase32(value, length) {
  let remaining = Number(value);
  const chars = Array.from({ length }, () => "0");
  for (let index = length - 1; index >= 0; index -= 1) {
    chars[index] = crockfordBase32[remaining % 32];
    remaining = Math.floor(remaining / 32);
  }
  return chars.join("");
}

function fillRandomValues(buffer) {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(buffer);
    return;
  }
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Math.floor(Math.random() * 256);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
