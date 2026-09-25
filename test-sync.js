// Tests for the permanent GitHub-gist sync mode: node --test test-sync.js
import test from "node:test";
import assert from "node:assert/strict";
import { derive, encrypt, decrypt, adopt, apiServer, GH_FILE } from "./test-helpers.js";

let server, base;
test.before(async () => {
  server = apiServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(() => server.close());

const bearer = tok => ({ Authorization: "Bearer " + tok, Accept: "application/vnd.github+json" });

test("same password derives the same secret, different passwords don't", async () => {
  const a = await derive("purple-monkey-42"), b = await derive("purple-monkey-42"), c = await derive("other");
  assert.equal(a.topic, b.topic);
  assert.notEqual(a.topic, c.topic);
  assert.equal(a.topic.length, "synctodo-".length + 32, "used as the ntfy topic fallback");
  const blob = await encrypt(a.key, { items: { x: { text: "hi" } }, updatedAt: 1 });
  assert.deepEqual(await decrypt(b.key, blob), { items: { x: { text: "hi" } }, updatedAt: 1 });
  await assert.rejects(() => decrypt(c.key, blob), /./, "wrong password cannot read the gist");
});

test("bad token is rejected", async () => {
  assert.equal((await fetch(base + "/user", { headers: bearer("wrong") })).status, 401);
});

test("gist round-trip: create secret gist, second device reads it, update flows back, 304 saves quota", async () => {
  const { key } = await derive("gist-password");
  const jsonHeaders = { ...bearer("good-token"), "Content-Type": "application/json" };

  const payloadA = await encrypt(key, { items: { a: { id: "a", text: "from PC", done: false, updatedAt: 100 } }, updatedAt: 100, from: "A" });
  const created = await fetch(base + "/gists", {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ description: "SyncTodo list (encrypted with your password)", public: false, files: { [GH_FILE]: { content: payloadA } } })
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const got = await fetch(base + "/gists/" + id, { headers: bearer("good-token") });
  assert.equal(got.status, 200);
  let etag = got.headers.get("ETag");
  assert.equal((await decrypt(key, (await got.json()).files[GH_FILE].content)).items.a.text, "from PC");

  const payloadB = await encrypt(key, { items: { a: { id: "a", text: "from PC", done: true, updatedAt: 200 } }, updatedAt: 200, from: "B" });
  const patched = await fetch(base + "/gists/" + id, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ files: { [GH_FILE]: { content: payloadB } } }) });
  assert.equal(patched.status, 200);

  const polled = await fetch(base + "/gists/" + id, { headers: { ...bearer("good-token"), "If-None-Match": etag } });
  assert.equal(polled.status, 200);
  assert.equal((await decrypt(key, (await polled.json()).files[GH_FILE].content)).items.a.done, true, "device A sees device B's change");

  const again = await fetch(base + "/gists/" + id, { headers: { ...bearer("good-token"), "If-None-Match": polled.headers.get("ETag") } });
  assert.equal(again.status, 304, "unchanged list costs nothing");
});

test("merge: stale snapshot never clobbers local edits, newer wins, deletes stick", async () => {
  const local = { items: { t1: { id: "t1", text: "buy milk", done: false, updatedAt: 500 } }, updatedAt: 500 };
  const stale = { items: { t1: { id: "t1", text: "buy milk", done: true, updatedAt: 100 } }, updatedAt: 100 };
  assert.deepEqual(adopt(local, stale), local);

  const newer = { items: { t1: { id: "t1", text: "buy milk", done: true, updatedAt: 900 }, t2: { id: "t2", text: "from phone", done: false, updatedAt: 400 } }, updatedAt: 900 };
  const merged = adopt(local, newer);
  assert.equal(merged.items.t1.done, true);
  assert.equal(merged.items.t2.text, "from phone");

  const tombstone = adopt({ items: { t2: { id: "t2", text: "x", updatedAt: 400 } }, updatedAt: 400 },
    { items: { t2: { id: "t2", text: "x", deleted: true, updatedAt: 1000 } }, updatedAt: 1000 });
  assert.equal(tombstone.items.t2.deleted, true);
});

test("the app actually wires up GitHub gist mode and the password vault", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  for (const needed of ["api.github.com/gists", "If-None-Match", "public:false", "synctodo.enc", "indexedDB", "rememberPw", "api/state", "server.json"]) {
    assert.ok(html.includes(needed), "index.html should contain " + needed);
  }
  // and the script is syntactically valid ES2017+ the browser can parse
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function(script);
});
