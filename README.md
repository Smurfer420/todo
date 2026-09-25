# SyncTodo

Quick & simple password-synced TODO. One HTML file, no accounts, no npm deps.
Same password on any device = same list. Todos are end-to-end encrypted
(AES-GCM) normally, and every item is merged "newest change wins".

There are **three ways** to sync. Pick one — the app figures out the rest from
what you fill in:

| Mode | What you need | Where the data lives | Permanent? |
|---|---|---|---|
| **GitHub gist** ⭐ | a GitHub token (once per device) | secret gist in **your** GitHub account | ✅ yes, PC can be off |
| Local server | run `node server.js` on a PC that stays on | `data/*.json` on that PC | ✅ yes, but PC must be on |
| ntfy relay | nothing | browser + public `ntfy.sh` | ⚠️ ~12h relay memory |

**For "I'm away from my PC, I want my notes" → use GitHub gist mode.**

---

## GitHub gist mode (recommended)

Your list is stored **encrypted with your password** inside a *secret gist* in
your own GitHub account. Nothing runs at home; GitHub's servers hold it. The
gist content is AES-GCM ciphertext, so GitHub (or anyone who finds the gist)
sees only gibberish.

**On your PC (first time)**
1. Open the app, expand **GitHub sync**
2. Create a token: [github.com/settings/tokens/new?scopes=gist](https://github.com/settings/tokens/new?scopes=gist&description=SyncTodo)
   → classic token → tick **`gist`** only → Generate → copy it
3. Paste the token into the token box, type your **sync password**, press **Connect**
4. Tick **Remember my password on this device** (optional convenience — uses a
   non-extractable key in IndexedDB, so the password isn't stored in plain text)

**On your phone**
5. Press **Link device** → the link is copied
6. Open that link on your phone, paste the **same token**, type the **same
   password**, press **Connect**

That's it. Add a todo on the phone while you're out, come home, open the PC —
it's there. Works in both directions, forever, with your PC switched off.

Notes:
- The token is stored in that browser's `localStorage` (it is a credential —
  use a gist-only token so its worst case is limited to gists).
- Polling is ~8s while the tab is open and pauses when it's in the background;
  unchanged lists use HTTP `304` so they don't burn your API quota.
- Same password + same gist = same list. Different password = unreadable.
- Plain `file://` won't work on some browsers for API calls — hosting it
  (GitHub Pages) is the reliable option, and it's what phone use needs anyway.

---

## Option 2 — local server (only if a PC is always on)

```sh
node server.js          # → http://localhost:8787
```

Saves every change to `data/<hash>.json` on disk immediately, with live push.
Reach it from your phone on the same Wi-Fi (`http://<pc-ip>:8787`) or via
Tailscale. Useless if the PC is off — that's exactly why gist mode exists.

---

## Option 3 — static, nothing configured

Leave the token empty: sync goes through the free public `ntfy.sh` relay,
encrypted the same way. Fast and zero setup, but the relay forgets messages
after ~12h, so long offline gaps may not reconcile. Your local copy is never
destroyed (stale snapshots are refused).

---

## Backup / restore

**⬇ Backup to file** downloads the whole list as plain JSON. **⬆ Restore from
file** merges a backup back in. Combine it with gist mode and you can never
really lose the list.

---

## Files

```
index.html        the whole app (UI + 3 sync modes + crypto)
server.js         optional zero-dependency permanent local server
test-sync.js      gist mode: crypto, round-trip, merge, 304, wiring
test-server.js    server mode: sync, isolation, persistence, SSE, restart
test-helpers.js   shared test crypto + fake GitHub API
package.json      npm start / npm test
```

## How sync works

- Password → SHA-256 → secret topic/ID **and** AES-GCM-256 key (password never
  leaves the device)
- Gist mode: `POST/PATCH/GET /gists/{id}` with `If-None-Match` conditional
  reads; file `synctodo.enc`, `public:false`
- Server mode: `PUT/GET /api/state?token=<sha256>` + SSE stream, atomic writes
- ntfy mode: encrypted blobs to `ntfy.sh`, live SSE, `?poll=1&since=` catch-up
- Merge rule everywhere: per-item `updatedAt` newest-wins, deletes are
  tombstones, and a stale snapshot can never overwrite newer local edits

> Use a strong password. Storage providers only ever see ciphertext/hashes, but
> anyone who knows the password can read the list.


