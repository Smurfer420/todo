# SyncTodo

Quick & simple password-synced TODO. One HTML file, no accounts, no npm deps.
Same password on any device = same list. Todos are end-to-end encrypted
(AES-GCM) normally, and every item is merged "newest change wins".

There are **two ways** to run it:

| | Where your data lives | Lasts forever? |
|---|---|---|
| **1. Local server** (`server.js`) | A JSON file on your PC, in `data/` | ✅ Yes |
| **2. Static** (`index.html` only) | Your browser + public `ntfy.sh` relay | ⚠️ ntfy keeps ~12h of messages |

Use the local server for "permanent". Use the static mode if you just want to
drop the file on GitHub Pages and not think about it.

---

## Option 1 — permanent server (recommended for PC + phone)

Requires Node 18+ (you already have it).

```sh
cd rnadomStuf
node server.js                 # http://localhost:8787
# or: node server.js --password "my secret" --port 8787
```

- Open `http://localhost:8787` on your PC → password → Connect
- Open the **same URL from your phone**, same password → same list
- Every change is written to `data/<hash>.json` on your PC **immediately**
- The page is auto-remembered, so next visit it reconnects by itself
- Lists are saved to disk, so they survive reboots, browser wipes, everything

Options: `--password <pw>` (informational), `--port 8787`, `--host 0.0.0.0`,
`--data <dir>`.

Each password gets its own file and its own private list. Nobody can read or
guess your list without your password (`data/<sha256>.json`).

### Reaching it while you're away

Your phone must reach your PC. Any of these work:

- **Same Wi-Fi**: `http://<pc-ip>:8787` (find the IP with `ip addr`)
- **Tailscale** (easiest, free): install on PC + phone → use
  `http://<pc-tailscale-name>:8787` from anywhere, no open ports
- **Cloudflare Tunnel / ngrok**: `cloudflared tunnel --url http://localhost:8787`
  → gives you an https URL you can bookmark on the phone
- **VPS / Raspberry Pi**: run the same `node server.js` there 24/7

Once you have a URL you like, add it to your phone's home screen — it looks and
behaves like a normal app.

Run the tests with `npm test` (or `node --test test-server.js`).

---

## Option 2 — static, no server

Just `index.html`, hosted anywhere (GitHub Pages, Netlify, a USB stick):

1. Push this repo to GitHub
2. **Settings → Pages → Deploy from branch → `main` / `/ (root)` → Save**
3. Open `https://<user>.github.io/<repo>/` on PC **and** phone
4. Same password on both → Connect → todos appear on each other in ~1-2s

Sync goes through the free public `ntfy.sh` relay with AES-GCM encryption, so
the relay only ever sees gibberish. **Caveat:** ntfy keeps about 12 hours of
messages, so if *both* devices stay offline for longer than that, changes from
that gap may not reconcile. Your local copy is never destroyed, and the app now
refuses stale snapshots, but use Option 1 when you need certainty.

---

## Backup / restore

**⬇ Backup to file** downloads your whole list as plain JSON. **⬆ Restore from
file** merges a backup back in (safe to do on a new machine). Keep a copy
somewhere — that is your "forever" copy, whatever mode you use.

---

## Files

```
index.html       the entire app (UI + sync + crypto)
server.js        optional zero-dependency permanent server
test-server.js   7 tests: sync, isolation, persistence, SSE, restart
package.json     npm start / npm test
```

## How sync works

- Password → SHA-256 → private token / topic + AES-GCM-256 key
- Server mode: `PUT/GET /api/state?token=…` + live SSE stream; atomic file
  writes (temp file + rename) and stale-write protection
- Static mode: encrypted blobs to `ntfy.sh`, live via SSE, catch-up via
  `?poll=1&since=`
- Merge rule everywhere: per-item `updatedAt`, deletes are tombstones, and a
  cached snapshot only wins if it is genuinely newer than your local copy

> Use a strong password. The relay/server only stores hashes and ciphertext, but
> anyone who guesses the password gets the list.

