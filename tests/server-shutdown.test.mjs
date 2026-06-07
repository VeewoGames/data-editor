import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createConnectionShutdown } from "../src/server-shutdown.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function connect(port) {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

test("createConnectionShutdown force closes lingering sockets so server shutdown can finish", async () => {
  let requestSeenResolve;
  const requestSeen = new Promise((resolve) => {
    requestSeenResolve = resolve;
  });
  const server = http.createServer((req, res) => {
    requestSeenResolve?.({ req, res });
  });
  const shutdown = createConnectionShutdown({ forceCloseDelayMs: 50 });
  shutdown.attach(server);

  const port = await listen(server);
  const socket = await connect(port);
  socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`);
  await requestSeen;

  const startedAt = Date.now();
  await shutdown.close(server);
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 1000, `expected forced shutdown within 1s, got ${elapsedMs}ms`);

  await delay(50);
  assert.equal(socket.destroyed, true);
});

test("createConnectionShutdown lets clean servers close without forced socket cleanup", async () => {
  const server = http.createServer((_req, res) => {
    res.end("ok");
  });
  const shutdown = createConnectionShutdown({ forceCloseDelayMs: 50 });
  shutdown.attach(server);

  await listen(server);
  await shutdown.close(server);
  assert.equal(server.listening, false);
});
