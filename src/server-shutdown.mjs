export function createConnectionShutdown({ forceCloseDelayMs = 250 } = {}) {
  const sockets = new Set();

  function attach(server) {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => {
        sockets.delete(socket);
      });
    });
  }

  async function close(server) {
    let destroyTimer = null;
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        if (sockets.size > 0) {
          destroyTimer = setTimeout(() => {
            for (const socket of sockets) {
              socket.destroy();
            }
          }, forceCloseDelayMs);
          destroyTimer.unref?.();
        }
      });
    } finally {
      if (destroyTimer) clearTimeout(destroyTimer);
    }
  }

  return { attach, close };
}
