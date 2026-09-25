# SyncTodo

Quick & simple password-synced TODO — one file, no backend, no account.

Same password on any device = same list. Everything is end-to-end encrypted
(AES-GCM) before it leaves your browser. Sync via public `ntfy.sh`.

## Use it (GitHub Pages)

1. Push this to GitHub (see below)
2. Repo **Settings → Pages → Deploy from branch → `main` / `/ (root)` → Save**
3. Open `https://<your-user>.github.io/<repo>/` on PC **and** phone
4. Enter the same password on both → **Connect**
5. Add a todo on PC → it appears on phone in ~1-2s

## Run locally

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## How sync works

- Password → SHA-256 → secret topic `synctodo-<hash>` + AES-GCM-256 key
- Publishes encrypted blobs to `https://ntfy.sh/<topic>`, live via SSE,
  catch-up for offline devices via `?poll=1&since=`
- Last-write-wins merge per todo, `localStorage` backup per topic

> Needs internet. ntfy.sh is free with ~12h message cache. Use a strong
> password — the server only sees gibberish, but anyone guessing your topic
> sees the encrypted blobs.
