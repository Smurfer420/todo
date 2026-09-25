// Shared helpers for test-sync.js: the same crypto the client uses, plus a fake GitHub Gist API.
import http from "node:http";
import crypto from "node:crypto";

export const GH_FILE = "synctodo.enc";
const te = new TextEncoder(), td = new TextDecoder();
const b64e = buf => Buffer.from(buf).toString("base64");
const b64d = s => new Uint8Array(Buffer.from(s, "base64"));
const subtle = crypto.webcrypto.subtle;

export async function derive(password) {
  const sha = s => crypto.createHash("sha256").update(s).digest("hex");
  const raw = Buffer.from(sha("synctodo-enc-v1:" + password), "hex");
  const key = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { topic: "synctodo-" + sha("synctodo-topic-v1:" + password).slice(0, 32), key };
}
export async function encrypt(key, obj) {
  const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, iv: b64e(iv), data: b64e(ct) });
}
export async function decrypt(key, s) {
  const o = JSON.parse(s);
  if (o.v !== 1) throw new Error("bad version");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64d(o.iv) }, key, b64d(o.data));
  return JSON.parse(td.decode(pt));
}
// the client's merge rule: newer updatedAt wins per item, older snapshot is ignored
export function adopt(local, remote) {
  if (!remote || !remote.items) return local;
  if ((remote.updatedAt || 0) <= (local.updatedAt || 0)) return local;
  const merged = { ...remote.items };
  for (const [id, li] of Object.entries(local.items || {})) {
    const ri = merged[id];
    if (!ri || (li.updatedAt || 0) > (ri.updatedAt || 0)) merged[id] = li;
  }
  return { items: merged, updatedAt: remote.updatedAt };
}

export const requests = [];
export function apiServer() {
  let gist = null, etagSeq = 0;
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    requests.push(req.method + " " + url.pathname);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE",
      "Access-Control-Expose-Headers": "ETag"
    };
    const send = (code, obj, extra) => { res.writeHead(code, { ...cors, ...(extra || {}) }); res.end(obj === undefined ? undefined : JSON.stringify(obj)); };
    if (req.method === "OPTIONS") return send(204);
    if (req.headers.authorization !== "Bearer good-token") return send(401, { message: "Bad credentials" });
    if (url.pathname === "/user") return send(200, { login: "smurfer" });

    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      if (req.method === "POST" && url.pathname === "/gists") {
        gist = { id: "g" + (++etagSeq), files: { [GH_FILE]: { content: body.files[GH_FILE].content } }, public: body.public };
        return send(201, { id: gist.id, files: gist.files }, { ETag: 'W/"' + etagSeq + '"' });
      }
      const id = url.pathname.replace("/gists/", "");
      if (!gist || gist.id !== id) return send(404, { message: "Not Found" });
      if (req.method === "GET") {
        if (req.headers["if-none-match"] === 'W/"' + etagSeq + '"') return send(304);
        return send(200, { id: gist.id, files: gist.files }, { ETag: 'W/"' + etagSeq + '"' });
      }
      if (req.method === "PATCH") {
        gist.files[GH_FILE].content = body.files[GH_FILE].content;
        etagSeq++;
        return send(200, { id: gist.id, files: gist.files }, { ETag: 'W/"' + etagSeq + '"' });
      }
      return send(405, {});
    });
  });
}
