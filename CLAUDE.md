# Prism — working notes for Claude

## Ship every change

This project deploys to Vercel (`prism0-9`) from `main`. The production
site is https://prism0-9.vercel.app, and a push to `main` is what builds
it — nothing else does.

So: **finish every change by committing and pushing to `main`.** A change
sitting in the working tree, or on a feature branch, is invisible to the
person who asked for it. Work on `claude/website-redesign-gtkcxj`, then
merge to `main` and push, unless told otherwise.

Verify before pushing, because a red build means the site keeps serving
the previous version and the change silently does not appear:

```
npx tsc --noEmit && npm run lint && npm run build
```

To look at a page rather than trust the build: write a `.env.local` from
`.env.local.example` (placeholder Supabase values are enough for `/login`,
the only route that renders unauthenticated), `npx next start`, and drive
it with Playwright — Chromium is at `/opt/pw-browsers/chromium`.

## The design system

Dark only. The light theme, its toggle and its provider were removed
deliberately; `user_settings.theme` still exists in the database but is
ignored.

The organising rule is **colour is taxonomy, not decoration**. Chrome —
buttons, borders, focus rings, links — is achromatic cream on near-black.
Every hue is spoken for by a vehicle state, so a coloured pixel always
means something about a truck:

| token | value | meaning |
|---|---|---|
| `--green` | `#0ae448` | moving, on-route |
| `--amber` | `#ff8709` | idle, stale |
| `--cyan` | `#00bae2` | parking, stations, informational |
| `--pink` | `#fec5fb` | destinations — sites, the factory |
| `--red` | `#ff4d3d` | off-route, speeding |

Do not spend one of these on chrome, and do not introduce a sixth. There
is no purple anywhere — that was the point of the overhaul.

Other rules that are easy to break by accident:

- **No drop shadows.** Depth is a surface step (`--bg` → `--panel` →
  `--panel-2` → `--panel-3`) plus a `--line` hairline. The sole exception
  is `.glass--float`, for panels over live map tiles, where a surface
  step cannot separate a panel from imagery moving underneath it.
- **Controls are outlined, never filled.** `.btn-primary` is a cream
  hairline pill at 100px radius. The system allows exactly one chromatic
  escalation per screen — a gradient stroke, via `.btn-brand` — for the
  single most important action.
- **All colour resolves through a token in `globals.css`.** Two places
  cannot and are noted in the source: Leaflet marker HTML, which Leaflet
  injects as strings, and Chart.js, which paints to canvas. Both repeat
  the taxonomy as literals and must be kept in step by hand.
- Keep this app's density. Table type at ~0.72rem is deliberate —
  dispatch needs forty trucks on one screen.
- `.glass` and `.panel` are the same rule; `.glass` survives only because
  26 call sites use it. Prefer `.panel` in new markup.

## Agent skills

`.agents/skills/` is installed build output and is gitignored;
`skills-lock.json` is committed and pins the set. Reproduce with
`npx skills@latest add <owner>/<repo>`.

Several of those skills are written for landing pages and carry defaults
that fight this codebase — a 14px body floor, "max one accent colour",
bans on centred layouts. Take their method, not their category defaults:
this is a dense operations dashboard, not a marketing site.
