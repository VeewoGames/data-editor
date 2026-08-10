import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = parse(process.argv.slice(2));
if (!args.command || !args.entry || !args.input) process.exit(2);
const input = await readFile(args.input, "utf8");
const child = spawn(args.command, [args.entry, ...args.fixedArgs], { cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
child.stdin.end(input); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.once("error", () => process.exit(3)); child.once("close", (code) => process.exit(Number.isInteger(code) ? code : 4));

function parse(values) { const result = { fixedArgs: [] }; for (let index = 0; index < values.length; index += 1) { const key = values[index]; const value = values[++index]; if (key === "--fixed-arg") result.fixedArgs.push(value); else if (key === "--command") result.command = value; else if (key === "--entry") result.entry = value; else if (key === "--input") result.input = value; else process.exit(2); } return result; }
