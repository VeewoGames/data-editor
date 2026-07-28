import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const options = Object.fromEntries(process.argv.slice(2).map((value) => {
  const separator = value.indexOf("=");
  return separator < 0 ? [value, ""] : [value.slice(0, separator), value.slice(separator + 1)];
}));
const pidFile = options["--pid-file"];
const marker = options["--marker"];
const mode = options["--mode"] ?? "normal";
const markerDelayMs = Number(options["--marker-delay-ms"] ?? 0);
const lifetimeMs = Number(options["--lifetime-ms"] ?? 200);

if (pidFile) appendFileSync(pidFile, `${process.pid}\n`, "utf8");
if (marker) setTimeout(() => writeFileSync(marker, `${process.pid}\n`, "utf8"), markerDelayMs);

if (mode === "normal") {
  setTimeout(() => process.exit(0), lifetimeMs);
} else if (mode === "descendant") {
  setInterval(() => {}, 1000);
} else {
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url),
    "--mode=descendant",
    `--pid-file=${pidFile}`,
    ...(marker ? [`--marker=${marker}`, `--marker-delay-ms=${markerDelayMs}`] : []),
  ], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (mode === "root-exit") {
    child.unref();
    setTimeout(() => process.exit(0), 100);
  } else {
    setInterval(() => {}, 1000);
  }
}
