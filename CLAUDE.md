# CLAUDE.md

Personal site for Seamus Woods, served by GitHub Pages at **seamusw.oods.dev**
(`CNAME`). Hand-written static HTML, CSS and JavaScript — no framework, no
bundler, no package manager, no CI. What is in the repo is exactly what ships.

## Running it

```bash
python -m http.server 4173     # then open http://localhost:4173
```

That is the whole toolchain, and it is what `.claude/launch.json` starts. Open a
file directly with `file://` and relative asset paths still work, but `fetch` to
the train API will be blocked by CORS, so use the server.

There is no build, no test suite and no linter. Verification is: load the page,
check the console is clean, resize to a narrow viewport, and check the
reduced-motion path (DevTools → Rendering → Emulate `prefers-reduced-motion`).

## Deployment

Pushing to `main` publishes. `.nojekyll` is present so Jekyll never touches the
output — a directory or file starting with `_` would otherwise vanish.

## Layout

```
index.html              Home page: about, projects, sketches, 3D design, contact
style.css               Every page's styles. One stylesheet, no per-page CSS.
trains/index.html       Live train map page
sketches/random-walk.html  Standalone sketch page
sketches/random-walk.js    Page controller for that sketch (config + buttons)
assets/walk.js          createWalkSketch() — shared p5 walk, used by both pages
assets/departures.js    Departure board widget on the home page
assets/train-map.js     Pan/zoom/select map, plots trains on the SVG
assets/ireland.js       IRELAND outline path + projectPoint(lon, lat)
assets/railways.js      RAILWAYS — rail network as one SVG path
assets/analytics.js     GoatCounter count + campaign query-string cleanup
favicon.svg, favicon-32.png, apple-touch-icon.png
```

`assets/ireland.js` and `assets/railways.js` are **generated data**, not code to
hand-edit. Ireland comes from Natural Earth 1:50m admin-0 (Republic polygons plus
the Northern Ireland ring, so it is the island, not one jurisdiction). Railways
come from OpenStreetMap via Overpass, chained into continuous polylines before
simplification. The generators live outside this repo; the file header comments
record the parameters used. If the outline changes, the projection constants
(`lonMin`, `latMax`, `cosLat`, `scale`, `pad`) and the SVG `viewBox` in
`trains/index.html` must change with it — they come from the same generator run.

## External dependencies

Three, all loaded from a CDN or a remote host — nothing is vendored:

| What | Where | Notes |
| --- | --- | --- |
| p5.js 1.11.10 | cdnjs, with SRI hash | Only on pages running the walk sketch. Keep `integrity`/`crossorigin` when bumping the version, and update the hash. |
| GoatCounter | `gc.zgo.at/count.js` | Cookieless, no personal data, so no consent banner. Loaded with `no_onload`. |
| Train API | `https://trains.oods.dev/…` | Self-hosted FastAPI in Docker behind a Cloudflare tunnel. `GET /display?mins=90` for the board, `GET /positions` for the map. It goes down; the site must not care. |

## Conventions

### Comments explain why, not what

This is the single strongest convention in the codebase, and matching it matters
more than any style rule. Nearly every non-obvious line carries a comment saying
what would go wrong without it — a failing contrast ratio, an analytics field
that would be silently lost, a phone that could not scroll past the map. Read the
surrounding comments before changing a line; the reason it looks odd is usually
written directly above it. When you change the behaviour, update the reason too.

### Two JavaScript dialects, on purpose

- `assets/*.js` (except `walk.js`) is ES5 in an IIFE: `var`, `function`, feature
  checks before use (`if (!window.fetch || !window.AbortController) return;`).
  These run on every visitor's browser and must not break anything old.
- `assets/walk.js` and `sketches/random-walk.js` use `const`/arrow functions.
  They already depend on p5.js, so the floor is higher.

Follow whichever dialect the file you are editing already uses.

### Never build markup from remote data

Everything from the train API goes into the DOM as `textContent` via
`document.createElement`. There is no `innerHTML` in this repo and there should
not be — the payload is proxied third-party data.

### Degrade, don't apologise

The home-page departure board fails **silently**: if the server is unreachable it
renders nothing, and the surrounding prose describing the project stands on its
own. The `#departures-note` paragraph and the Refresh button are revealed only on
a successful render, so neither ever describes a table that is not there.

The train map is the opposite, because the map *is* the page: the island still
draws and the status line says positions are unavailable.

A user-initiated refresh always gets an answer either way — somebody asked.

### Accessibility

- `role="status"` / `aria-live="polite"` regions are written to **only** on
  manual refreshes. The map reloads every 60s and on tab focus; announcing those
  would leave a screen reader chattering all day.
- Decorative SVG gets `aria-hidden="true"` `focusable="false"` when the adjacent
  text already says what it is.
- `prefers-reduced-motion` is honoured everywhere: the walk starts paused (with a
  visible note and a Play button), the count-up animation is skipped and the
  literal figure stays in the markup, the live dot stops pulsing, and the table
  flash is suppressed.
- Colours must clear WCAG AA against the paper ground. `--ink-faint` is `#756a5c`
  at 4.56:1 — the comment records that the previous value failed at 3.39:1. Check
  any new colour before using it.

### Styling

One stylesheet for the whole site, sectioned by comment banners
(`/* --- Train map --- */`). Colours, the `--measure` text column and the serif
stack are custom properties on `:root`. The theme is deliberately light in both
colour schemes — there is **no** `prefers-color-scheme: dark` variant, and adding
one would be a design change, not a fix. `.placeholder` visibly marks unfinished
copy so it cannot ship unnoticed.

### Analytics

`assets/analytics.js` is load-order sensitive and the failure is silent. The
GoatCounter tag sets `no_onload`, which disables both `count()` and
`bind_events()`; the script calls both by hand, and strips the campaign query
string only *after* counting — strip it earlier and every `utm_campaign` link
stops reporting with no error. `index.html` also rewrites `/index.html` to `/`
before the counter runs, so one page does not split into two rows. Outbound links
worth measuring carry `data-goatcounter-click="…"`.

### Per-page head

Every page repeats the same block: `canonical`, `og:type`/`site_name`/`title`/
`description`/`url`/`image` (+ dimensions and alt), `twitter:card` = `summary`,
and the three icon links. `og:title` and `og:description` are copied verbatim
from that page's own `<title>` and `meta[name=description]` — keep them in step.
`og:image` and `og:url` must be absolute; the icon links stay page-relative
(`../` from a subdirectory). The card is `summary`, not `summary_large_image`,
because the image is the 180px square app icon.

### Hand-maintained figures

The MakerWorld stats in the design section are typed into the markup. MakerWorld
blocks server-side requests and sends no CORS headers, so they cannot be fetched.
Update both the visible text and `data-value` (which only drives the count-up),
and the "All 13 models" link text, together.

## Commits

Messages follow a consistent house style, and it is worth matching:

- Subject: a short sentence in plain English, sentence case, no prefix or scope
  tag. "Tell the reader when a refresh actually worked", not "fix(ui): status".
- Body: state the problem that existed first, then what the change does about it,
  then the trade-offs and anything deliberately left alone. Wrap around 75
  columns. Concrete numbers where they exist ("4,254 ways become 158 polylines").
- Footer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

Work happens on a branch and lands on `main` through a pull request.
