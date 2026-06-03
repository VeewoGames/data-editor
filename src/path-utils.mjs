export function getByPath(root, pathParts) {
  let current = root;
  for (const part of pathParts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export function setByPath(root, pathParts, value) {
  if (pathParts.length === 0) throw new Error("Cannot set empty path");
  let current = root;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const part = pathParts[i];
    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot traverse non-object at ${pathParts.slice(0, i).join(".")}`);
    }
    current = current[part];
  }
  current[pathParts[pathParts.length - 1]] = value;
}

export function deleteByPath(root, pathParts) {
  if (pathParts.length === 0) throw new Error("Cannot delete empty path");
  const parent = getByPath(root, pathParts.slice(0, -1));
  if (parent && typeof parent === "object") delete parent[pathParts[pathParts.length - 1]];
}
