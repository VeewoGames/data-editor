import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectProcessService, processError } from "../src/project-process-service.mjs";

export async function runProjectProcessCli(argv) {
  const [action, ...args] = argv;
  if (!["status", "start", "stop", "open"].includes(action)) throw processError("PROCESS_CLI_INVALID", "用法：project-process.mjs <status|start|stop|open> --project <root> --process-id <id> --registry-home <home>", 400);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--project", "--process-id", "--registry-home"].includes(args[i]) || !args[i + 1] || values[args[i]]) throw processError("PROCESS_CLI_INVALID", "CLI 参数缺失、重复或未知。", 400);
    values[args[i]] = args[i + 1];
  }
  if (!values["--project"] || !values["--process-id"] || !values["--registry-home"]) throw processError("PROCESS_CLI_INVALID", "必须明确指定 project、process-id 和 registry-home。", 400);
  const owner = createProjectProcessService({ home: path.resolve(values["--registry-home"]) });
  const projectId = await owner.projectIdForRoot(values["--project"]);
  const processId = values["--process-id"];
  if (action === "open") return owner.open(projectId, processId);
  const snapshot = await owner.list(projectId);
  const current = snapshot.processes.find(item => item.processId === processId);
  if (!current) throw processError("PROCESS_BINDING_UNKNOWN", "项目未声明此后台计算。", 404);
  if (action === "status") return current;
  return owner.control({ projectId, processId, action, expectedGeneration: current.generation,
    declarationDigest: current.declarationDigest, expectedIntentVersion: current.intentVersion });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runProjectProcessCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    const results = result.processes ?? [result];
    process.exitCode = results.some(item => item.code === "AUTH_REQUIRED" || item.error) ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code ?? "PROCESS_CLI_FAILED", error: error.message })}\n`);
    process.exitCode = 1;
  }
}
