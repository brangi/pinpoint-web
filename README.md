# pinpoint-web

Public web viewers for Pinpoint, hosted at [pinpointing.me](https://pinpointing.me) via GitHub Pages.

| Path | What it shows |
|---|---|
| `/live.html?u={uid}&t={token}` | Real-time Live Share viewer (MQTT over WSS) |
| `/?route={encoded_polyline}` | Static completed-trip viewer (Google polyline) |
| `/` (no `route` param) | Branded empty state + App Store CTA |

## Local development

```bash
npm install      # one-time, installs tailwindcss only
npm run watch    # rebuilds dist/styles.css on every src/input.css save
npm run serve    # serves the repo on http://localhost:8000 (in another terminal)
```

Open:
- `http://localhost:8000/live.html?u=<uid>&t=<token>&env=dev`
- `http://localhost:8000/?route=<encoded-polyline>`
- `http://localhost:8000/` (empty state)

## Build before deploying

`dist/styles.css` is checked into the repo so GitHub Pages can serve it directly — there is no build step running in production. **Always run `npm run build` before committing.**

```bash
npm run build    # produces minified dist/styles.css (~19 KB)
git add dist/styles.css live.html index.html ...
git commit
git push
```

## Project layout

```
.
├── assets/             # brand SVGs (logo + dark-mode variant), copied from pinpoint-website
├── css/                # (legacy, empty — previous hand-rolled CSS now in src/input.css)
├── dist/
│   └── styles.css      # built Tailwind output, served by GitHub Pages
├── js/
│   ├── env-config.js     # broker URL + viewer creds per env (dev/prod)
│   ├── live-viewer.js    # live.html state machine: MQTT, pin, info card, dark toggle
│   ├── route-viewer.js   # index.html state machine: polyline decode + render
│   └── theme-toggle.js   # shared dark-mode toggle (index.html only; live.html inlines it)
├── src/
│   └── input.css         # Tailwind entry: @tailwind directives + custom @layer utilities
├── live.html
├── index.html
├── tailwind.config.js    # mirrors pinpoint-website/tailwind.config.js
├── CNAME                 # pinpointing.me → GitHub Pages
└── package.json
```

## Design language

Brand tokens (colors, fonts, glow effects) mirror `pinpoint-website` so the viewer feels like a natural extension of the marketing site:

- **Display font**: Clash Display (Fontshare)
- **Body font**: Satoshi (Fontshare)
- **Primary blue**: `#3B82F6` / hover `#2563EB`
- **Hero radial gradient backdrop**: `.hero-bg-pattern`
- **Glow shadow**: `.glow-blue` / hover ring on CTAs
- **Dark mode**: manual toggle (sun/moon icon, top-right). First-paint reads `localStorage.pinpoint-theme`, falls back to `prefers-color-scheme`. User override persists.

When updating brand tokens, copy the relevant block from `pinpoint-website/tailwind.config.js` and `pinpoint-website/src/styles/main.css` into this repo's `tailwind.config.js` and `src/input.css`, then run `npm run build`.

## States

### Live viewer (`live.html`)
- **Connecting** — top pill "Connecting…" with pulsing green dot
- **Live · fresh** — pill "Live", green dot, freshness caption "Live · just now"
- **Live · stale** (>60s without update) — pill "Stale", amber dot, pin desaturates
- **Ended** — pill "Share ended", pin grays, auto-redirects to `pinpointing.me` after 5s
- **Invalid link** — full-screen empty state with App Store CTA

### Route viewer (`index.html`)
- **Valid `?route=`** — map with polyline + start/end pins + distance card
- **No `?route=`** — branded empty state hero
- **Invalid polyline** — same empty state with error copy

## Security note

Viewer MQTT credentials are visible in `env-config.js` to anyone with DevTools. This is intentional: the creds are sub-only via EMQX ACL — they can only listen, never publish. Tokens are 16 random bytes (128 bits entropy), so guessing one is impractical. Future hardening: per-share JWT issued by a Cloud Function.
