// SyncTodo permanent server — zero dependencies, just Node.
//   node server.js                 # then open http://localhost:8787
//   node server.js --password secret --port 8787 --host 0.0.0.0
//
// Stores one JSON file per password-hash in ./data. Nothing leaves your machine.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const PORT = Number(flag("port", process.env.PORT || 8787));
const HOST = flag("host", "0.0.0.0");
const CLI_PASSWORD = flag("password", "");
const DATA_DIR = path.resolve(flag("data", path.join(HERE, "data")));
const INDEX = path.join(HERE, "index.html");
const MAX_BODY = 2 * 1024 * 1024;

const listeners = new Set();
const log = (...a) => console.log(new Date().toISOString(), ...a);

function hashPassword(pw) {
  return crypto.createHash("sha256").update("synctodo-server-v1:" + pw).digest("hex");
}
function emptyState() {
  return { items: {}, updatedAt: 0 };
}
function emptyStore(token) {
  return { passwordHash: token, items: {}, updatedAt: 0, createdAt: Date.now() };
}
function storePath(token) {
  return path.join(DATA_DIR, token.slice(0, 32) + ".json");
}
function mergeItems(base, incoming) {
  const out = { ...base };
  let changed = false;
  for (const [id, item] of Object.entries(incoming || {})) {
    if (!item || typeof item !== "object") continue;
    const prev = out[id];
    if (!prev || (item.updatedAt || 0) > (prev.updatedAt || 0)) {
      out[id] = { id, text: String(item.text || "").slice(0, 300), done: !!item.done, deleted: !!item.deleted, updatedAt: item.updatedAt || 0 };
      changed = true;
    }
  }
  return { items: out, changed };
}
async function readStore(token) {
  try {
    const raw = await fsp.readFile(storePath(token), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.items !== "object") throw new Error("bad shape");
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    log("store unreadable, starting fresh:", err.message);
    try {
      await fsp.rename(storePath(token), storePath(token) + ".corrupt-" + Date.now());
    } catch {}
    return null;
  }
}
async function writeStore(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const file = storePath(store.passwordHash);
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(store));
  await fsp.rename(tmp, file);
}
function broadcast(data) {
  const frame = "data: " + JSON.stringify(data) + "\n\n";
  for (const res of listeners) {
    try {
      res.write(frame);
    } catch {}
  }
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function sendFile(res, file, type) {
  fs.stat(file, (err, st) => {
    if (err) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
}

async function handleAuthAndState(req, res, token) {
  let store = await readStore(token);
  if (!store) {
    store = emptyStore(token);
    await writeStore(store);
    log("created new list for", token.slice(0, 8) + "…");
  }
  if (req.method === "GET") {
    return json(res, 200, { items: store.items, updatedAt: store.updatedAt });
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
  const incoming = body && body.items ? body.items : {};
  const { items, changed } = mergeItems(store.items, incoming);
  if (changed || (body.updatedAt || 0) > (store.updatedAt || 0)) {
    store.items = items;
    store.updatedAt = Math.max(store.updatedAt || 0, body.updatedAt || 0, Date.now());
    await writeStore(store);
    broadcast({ items: store.items, updatedAt: store.updatedAt, from: body.from || "" });
  }
  return json(res, 200, { items: store.items, updatedAt: store.updatedAt });
}

function handleEvents(req, res, token) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
  listeners.add(res);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, 25000);
  const cleanup = () => {
    clearInterval(ping);
    listeners.delete(res);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const route = url.pathname;

  if (route === "/server.json") {
    return json(res, 200, { app: "synctodo", mode: "server", version: 1, auth: true });
  }
  if (route === "/api/events") {
    const token = url.searchParams.get("token") || "";
    if (!token) return json(res, 401, { error: "missing token" });
    return handleEvents(req, res, token);
  }
  if (route === "/api/state") {
    const token = url.searchParams.get("token") || "";
    if (!token) return json(res, 401, { error: "missing token" });
    if (req.method !== "GET" && req.method !== "PUT" && req.method !== "POST") {
      return json(res, 405, { error: "method not allowed" });
    }
    if (!/^[a-f0-9]{64}$/.test(token)) return json(res, 400, { error: "bad token" });
    return handleAuthAndState(req, res, token);
  }
  if (req.method === "GET" && (route === "/" || route === "/index.html")) {
    return sendFile(res, INDEX, "text/html; charset=utf-8");
  }
  if (req.method === "GET" && /^\/[A-Za-z0-9._-]+\.(js|css|svg|png|ico|webmanifest|json)$/.test(route)) {
    const file = path.join(HERE, path.basename(route));
    const ext = path.extname(file).slice(1);
    const types = { js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json", json: "application/json" };
    return sendFile(res, file, types[ext] || "application/octet-stream");
  }
  return json(res, 404, { error: "not found" });
});

function shutdown() {
  log("shutting down");
  for (const res of listeners) {
    try {
      res.end();
    } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  log("SyncTodo server on http://" + shown + ":" + PORT);
  log("data dir:", DATA_DIR);
  if (!CLI_PASSWORD) {
    log("no --password given: any password creates its own private list");
  } else {
    log("CLI password accepted; token hash =", hashPassword(CLI_PASSWORD).slice(0, 12) + "…");
  }
});

