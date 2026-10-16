import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

// Short operation lock shared by HTTP and offline CLI. The project owns its
// separate long-lived instance lock; no process state is persisted here.
export function projectProcessLockName(key) {
  const user = os.userInfo();
  const digest = createHash("sha256").update(`${user.username}\0${user.homedir}\0${key}`).digest("hex");
  return `\\\\.\\pipe\\data-editor-project-process-${digest}`;
}

export async function withProjectProcessLock(key, operation, { timeoutMs = 15000 } = {}) {
  if (process.platform !== "win32") throw Object.assign(new Error("项目进程控制目前仅支持 Windows。"), { code: "PROCESS_PLATFORM_UNSUPPORTED", status: 409 });
  const deadline = Date.now() + timeoutMs;
  let server;
  do {
    const candidate = net.createServer(socket => socket.destroy());
    const acquired = await new Promise((resolve, reject) => {
      candidate.once("error", error => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
      candidate.listen(projectProcessLockName(key), () => resolve(true));
    });
    if (acquired) { server = candidate; break; }
    await delay(50);
  } while (Date.now() < deadline);
  if (!server) throw Object.assign(new Error("后台计算操作繁忙，请刷新状态后重试。"), { code: "PROCESS_OPERATION_BUSY", status: 409 });
  try { return await operation(); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
