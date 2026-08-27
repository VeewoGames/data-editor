import path from "node:path";
import { cp, lstat, mkdir, readdir, realpath } from "node:fs/promises";

const options = readOptions(process.argv.slice(2));
const projectRoot = await realpath(required(options, "--project-root"));
const inputRoot = path.resolve(required(options, "--input-root"));
const paths = JSON.parse(required(options, "--paths-json"));
if (!Array.isArray(paths) || paths.some((value) => typeof value !== "string" || !value.trim())) {
  throw new Error("PROJECT_SKILL_INPUT_PATHS_INVALID");
}

await mkdir(inputRoot, { recursive: false });
for (const relative of paths) {
  const source = path.resolve(projectRoot, relative);
  const resolved = await realpath(source).catch(() => null);
  if (!resolved || !isInside(projectRoot, resolved)) throw new Error(`PROJECT_SKILL_INPUT_PATH_INVALID: ${relative}`);
  await assertNoLinks(source);
  const stat = await lstat(source);
  const target = path.join(inputRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: stat.isDirectory(), force: false, errorOnExist: true, dereference: false });
}

async function assertNoLinks(target) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw new Error("PROJECT_SKILL_INPUT_LINK_UNSUPPORTED");
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(target)) await assertNoLinks(path.join(target, entry));
}

function readOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) options.set(argv[index], argv[index + 1]);
  return options;
}

function required(options, key) {
  const value = options.get(key);
  if (typeof value !== "string" || !value) throw new Error(`Missing ${key}`);
  return value;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
