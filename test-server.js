// Tests for server.js:  node --test test-server.js
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const tokenFor = pw => crypto.createHash("sha256").update("synctodo-server-v1:" + pw).digest("hex");

let dir, child;

async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/server.json");
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 120));
  }
  throw new Error("server did not start");
}

test.before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "synctodo-test-"));
  child = spawn(process.execPath, [path.join(HERE, "server.js"), "--port", String(PORT), "--data", dir], {
    stdio: "ignore"
  });
  await waitForServer();
});

test.after(async () => {
  if (child) child.kill("SIGKILL");
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("announces itself as a server", async () => {
  const r = await fetch(BASE + "/server.json");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { app: "synctodo", mode: "server", version: 1, auth: true });
});

test("serves the app html", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /SyncTodo/);
  assert.match(html, /<ul id="list">/);
  // the client knows how to talk to a server
  assert.match(html, /api\/state/);
  assert.match(html, /api\/events/);
  assert.match(html, /server\.json/);
  assert.match(html, /Backup to file/);
});

test("rejects bad tokens", async () => {
  assert.equal((await fetch(BASE + "/api/state")).status, 401);
  assert.equal((await fetch(BASE + "/api/state?token=nope")).status, 400);
});

test("two devices with the same password share one permanent list", async () => {
  const token = tokenFor("hunter2-device-sync");
  const devA = { method: "PUT", headers: { "Content-Type": "application/json" } };

  const now = Date.now();
  let r = await fetch(`${BASE}/api/state?token=${token}`, {
    ...devA,
    body: JSON.stringify({ items: { a1: { id: "a1", text: "buy milk", done: false, updatedAt: now } }, updatedAt: now, from: "A" })
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).items.a1.text, "buy milk");

  // device B (fresh) pulls the same list
  const b = await (await fetch(`${BASE}/api/state?token=${token}`)).json();
  assert.equal(b.items.a1.text, "buy milk");

  // device B checks it off, device A sees the change
  const t2 = now + 1000;
  await fetch(`${BASE}/api/state?token=${token}`, {
    ...devA,
    body: JSON.stringify({ items: { a1: { id: "a1", text: "buy milk", done: true, updatedAt: t2 } }, updatedAt: t2, from: "B" })
  });
  const a = await (await fetch(`${BASE}/api/state?token=${token}`)).json();
  assert.equal(a.items.a1.done, true);

  // stale write from A must not undo B's newer change
  await fetch(`${BASE}/api/state?token=${token}`, {
    ...devA,
    body: JSON.stringify({ items: { a1: { id: "a1", text: "buy milk", done: false, updatedAt: now } }, updatedAt: t2, from: "A" })
  });
  const a2 = await (await fetch(`${BASE}/api/state?token=${token}`)).json();
  assert.equal(a2.items.a1.done, true, "newer value wins");
});

test("different passwords are fully isolated", async () => {
  const other = await (await fetch(`${BASE}/api/state?token=${tokenFor("some-other-person")}`)).json();
  assert.deepEqual(other.items, {});
});

test("survives a restart (data is on disk)", async () => {
  const token = tokenFor("persist-me");
  const now = Date.now();
  await fetch(`${BASE}/api/state?token=${token}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: { p1: { id: "p1", text: "still here tomorrow", done: false, updatedAt: now } }, updatedAt: now })
  });
  child.kill("SIGKILL");
  await new Promise(r => child.on("exit", r));
  child = spawn(process.execPath, [path.join(HERE, "server.js"), "--port", String(PORT), "--data", dir], { stdio: "ignore" });
  await waitForServer();
  const after = await (await fetch(`${BASE}/api/state?token=${token}`)).json();
  assert.equal(after.items.p1.text, "still here tomorrow");
});

test("live events stream pushes updates to other devices", async () => {
  const token = tokenFor("stream-please");
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/events?token=${token}`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const pump = (async () => {
    while (!seen.includes('"text":"live todo"')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
  })();

  await new Promise(r => setTimeout(r, 150));
  const now = Date.now();
  await fetch(`${BASE}/api/state?token=${token}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: { s1: { id: "s1", text: "live todo", done: false, updatedAt: now } }, updatedAt: now, from: "x" })
  });
  await Promise.race([pump, new Promise(r => setTimeout(r, 4000))]);
  ac.abort();
  assert.match(seen, /"text":"live todo"/, "SSE pushed the new todo");
});
