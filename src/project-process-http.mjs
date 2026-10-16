import { processError } from "./project-process-service.mjs";

export function assertProjectProcessHttpSource(req, serverPort) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) throw processError("PROCESS_JSON_REQUIRED", "进程控制只接受 JSON 请求。", 415);
  const expected = `http://127.0.0.1:${serverPort}`;
  if (req.headers.host !== `127.0.0.1:${serverPort}` || req.headers.origin !== expected
    || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) throw processError("PROCESS_SOURCE_REJECTED", "进程控制请求必须来自本编辑器页面。", 403);
}
