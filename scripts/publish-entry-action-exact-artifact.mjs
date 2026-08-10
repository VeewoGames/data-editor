import { readFile } from "node:fs/promises";

const options = parse(process.argv.slice(2));
for (const key of ["url", "project-id", "artifact-id", "content-file"]) if (!options[key]) fail(`Missing --${key}`);
const content = await readFile(options["content-file"], "utf8");
const humanNotes = options["human-notes-file"] ? JSON.parse(await readFile(options["human-notes-file"], "utf8")) : null;
const response = await fetch(`${options.url.replace(/\/$/, "")}/api/entry-actions/publish-exact-artifact`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ projectId: options["project-id"], artifactId: options["artifact-id"], content, humanNotes }),
});
const result = await response.json();
if (!response.ok) { process.stderr.write(`${JSON.stringify(result)}\n`); process.exitCode = 1; }
else process.stdout.write(`${JSON.stringify(result)}\n`);

function parse(argv) { const value = {}; for (let i = 0; i < argv.length; i += 2) { const key = argv[i]?.replace(/^--/, ""); if (key) value[key] = argv[i + 1]; } return value; }
function fail(message) { throw Object.assign(new Error(message), { code: "EXACT_ARTIFACT_PUBLICATION_CLI_INVALID" }); }
