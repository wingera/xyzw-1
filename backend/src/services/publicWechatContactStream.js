const SSE_RETRY_MS = 5000;
const SSE_KEEPALIVE_MS = 20000;

const clients = new Set();
let keepaliveTimer = null;

const writeSseFrame = (res, lines = []) => {
  const payload = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  res.write(`${payload}\n\n`);
};

const ensureKeepaliveTimer = () => {
  if (keepaliveTimer || clients.size === 0) {
    return;
  }
  keepaliveTimer = setInterval(() => {
    clients.forEach((res) => {
      try {
        writeSseFrame(res, [": keepalive"]);
      } catch {
        clients.delete(res);
      }
    });
    if (clients.size === 0 && keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }, SSE_KEEPALIVE_MS);
  if (typeof keepaliveTimer.unref === "function") {
    keepaliveTimer.unref();
  }
};

const cleanupClient = (res) => {
  clients.delete(res);
  if (clients.size === 0 && keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
};

export const registerWechatContactsStreamClient = (res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  writeSseFrame(res, [`retry: ${SSE_RETRY_MS}`]);
  writeSseFrame(res, [
    "event: connected",
    `data: ${JSON.stringify({ at: new Date().toISOString() })}`,
  ]);

  clients.add(res);
  ensureKeepaliveTimer();
};

export const attachWechatContactsStreamCleanup = (req, res) => {
  const cleanup = () => cleanupClient(res);
  req.on("close", cleanup);
  res.on("close", cleanup);
};

export const broadcastWechatContactsChanged = () => {
  const payload = JSON.stringify({ at: new Date().toISOString() });
  clients.forEach((res) => {
    try {
      writeSseFrame(res, [
        "event: contacts_changed",
        `data: ${payload}`,
      ]);
    } catch {
      cleanupClient(res);
    }
  });
};
