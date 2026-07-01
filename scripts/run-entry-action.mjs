import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));

if (!args.handoff) {
  throw new Error("Missing --handoff");
}

const handoffPath = path.resolve(args.handoff);
const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
const startedPath = handoffPath.replace(/\.json$/i, ".started.json");

await writeFile(startedPath, `${JSON.stringify({
  version: 1,
  runId: handoff.runId,
  actionId: handoff.action?.id ?? null,
  projectId: handoff.project?.id ?? null,
  handoffPath,
  startedAt: new Date().toISOString(),
  status: "started",
}, null, 2)}\n`, "utf8");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--handoff") result.handoff = argv[index + 1];
  }
  return result;
}
