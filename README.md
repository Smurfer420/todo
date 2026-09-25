# SyncTodo

Quick & simple password-synced TODO. **One HTML file.** No accounts, no server,
no dependencies, nothing to install — and it keeps working while your PC is off.

Same password on any device = same list. Everything is encrypted with your
password (AES-GCM) *before* it leaves the browser, so whoever stores it only
ever sees gibberish.

| Mode | What you need | Where the list lives | Permanent? |
|---|---|---|---|
| **GitHub gist** ⭐ | a GitHub token (once per device) | secret gist in **your** GitHub account | ✅ yes, PC can be off |
| ntfy relay | nothing | browser + public `ntfy.sh` | ⚠️ ~12h relay memory |

---

## Setup on GitHub (5 minutes)

### 1. Put the file on GitHub

Create a new **empty** repo on GitHub (no README), then in this folder:

```sh
git remote add origin https://github.com/YOUR-USER/synctodo.git
git push -u origin main
```

If it asks for a password, use a **Personal Access Token** as the password
(GitHub → Settings → Developer settings → Tokens (classic) → `repo` scope).

> Only `index.html` matters for the app. The other files are tests + docs and
> are ignored by Pages.

### 2. Turn on GitHub Pages

Repo → **Settings** → **Pages** → Source: **Deploy from a branch** →
Branch: **`main`** / **`/ (root)`** → **Save**.

Wait ~1 minute. Your app is now live, for free, forever at:

```
https://YOUR-USER.github.io/synctodo/
```

### 3. Give the app a way to store your list

Create a token with only the **`gist`** permission:

**https://github.com/settings/tokens/new?scopes=gist&description=SyncTodo**
→ *classic token*, tick **`gist`** only → **Generate** → copy it.

### 4. Connect on your PC

Open your Pages URL → expand **GitHub sync** → paste the token → type a **sync
password** (something strong, e.g. `purple-monkey-42-!)`) → **Connect**.
Optionally tick **Remember my password on this device**, so next visit it
reconnects by itself.

Your list is now stored, encrypted, in a secret gist in your own account. You
can see it here: <https://gist.github.com>.

### 5. Put it on your phone

On the PC press **Link device** — a link like
`https://YOUR-USER.github.io/synctodo/?gist=abc123…` is copied to your clipboard.

Open that link on the phone → **Share → Add to Home Screen** → paste the **same
token**, type the **same password** → **Connect**.

Done. Add a todo on the phone while you're out; it's on the PC when you get
home. Works both ways, with your PC switched off.

### 6. (Optional) backup

**⬇ Backup to file** saves your whole list as plain JSON. **⬆ Restore from
file** merges it back. Belt and braces.

---

## No-GitHub mode

Leave the token empty and press **Connect**: sync goes through the free public
`ntfy.sh` relay, encrypted the same way, with zero setup. Fast, but the relay
forgets messages after ~12 hours, so long offline gaps may not reconcile. Your
local copy is never destroyed (stale snapshots are refused).

---

## Tests

No dependencies, just Node's built-in runner:

```sh
node --test test-sync.js
```

- crypto: same password → same key, different password can't decrypt
- gist round-trip against a fake GitHub API: create → other device reads →
  update → `304` short-circuit
- merge rules: newest wins, deletes stick, stale snapshot can't clobber edits
- build checks: client-only, one inline script, everything wired up

## Files

```
index.html        the whole app (UI + GitHub/ntfy sync + crypto)  ← deploy this
test-sync.js      tests: crypto, gist round-trip, merge, build sanity
test-helpers.js   shared test crypto + fake GitHub Gist API
README.md         this file
```

## How it works

- Password → SHA-256 → secret topic **and** an AES-GCM-256 key. The password never
  leaves the device and is never sent anywhere.
- Gist mode: `POST` to create, `PATCH` to save, `GET` with `If-None-Match` to poll
  (`304` costs no quota), file `synctodo.enc`, `public:false`.
- ntfy mode: encrypted blobs published/subscribed with SSE + catch-up polling.
- Merge rule everywhere: per-todo `updatedAt` newest-wins, deletes are
  tombstones, and a stale snapshot can never overwrite newer local edits.
- Both devices talk to GitHub directly from the browser — GitHub's API sends
  `Access-Control-Allow-Origin: *`, so no proxy or backend is needed.

> Use a strong password. Storage only ever sees ciphertext, but anyone who knows
> the password can read the list.



