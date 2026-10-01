# Asset Viewer — working notes for Claude

Unofficial fan viewer for Lunar Client cosmetics, served from `https://textures.lunarclientcdn.com` (CORS `*`). Vue 3 + Vite 8 + vue-router (hash history) + PrimeVue 5 (Aura, `.app-dark`) + three.js 0.186. The "Essential" nav entry is a "coming soon" stub (`providers/essential.ts`).

## Rules
- **`.env` holds `PRIMEUI_LICENSE`.** It must stay git-ignored. Never print, echo or commit it. (It ends up in the built JS; unavoidable for a client app.)
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Only commit/push when asked. The user typically says "commit and push"; commit locally and offer to push otherwise.
- Pronouns: they/them unless stated.
- Shell is Windows (Git Bash/PowerShell). Use Unix syntax in Bash. Don't run `sleep` chains in the foreground.

## Commands
- `npm run dev` (vite; I use `npx vite --port 5199`), `npm run build` (= `vue-tsc -b && vite build`). The build always prints a >500 kB chunk warning (known, ignorable).
- Type check alone: `npx vue-tsc -b` (silent = pass). `erasableSyntaxOnly` is on: no class parameter properties.
- `node scripts/coverage.mjs` — classifies every CDN index file as item / dependency / resource and must print `UNCLAIMED 0` (exit 1 otherwise). Run it after touching `lunar/catalog.ts`.
- `taskkill //F //IM node.exe` stops stray dev servers/CDP runs (Git Bash needs the double slashes).

## Architecture
- `src/cdn.ts`: `getIndexBuffer`, `getFileBuffer/Json/Text(hash)`, `fileUrl(hash)`. Everything on the CDN is content-hash addressed, so results are stored in Cache Storage forever (`assetviewer-cdn-v1`) with a retry/backoff fetch. **Always get bytes through this cache** (see CORS notes).
- `src/providers/types.ts`: `CosmeticProvider` interface (`categories`, `fields(category)`, `items`, `imageUrl`, `loadModel`, `rawFile`, `indexedFiles`, `fileItem`, `ensureDimensions`, `info`, `stats`). `CosmeticItem.fields` is the bag the filter/sort bar reads; `name` is read from `item.name`.
- `src/providers/lunar/catalog.ts` builds the catalog from the two root indexes (`LUNAR_INDEXES` in `config.ts`; text lines `path sha1 size mtime`): `cosmetics.json` (primary), the legacy CSV `cosmetics/index` (fills gaps, typo'd ids), badges/sprays/emotes/particles/misc as "resources", and any unlisted cosmetic files found by scanning. `Kind` = `gek | obj | wing2d | cloak | image | file`.
- `src/providers/lunar/index.ts`: the provider. `loadGek` (Bedrock `.geo.json` + `.anim.json` + texture), `loadWing2d` (flat wing webp on `simple_2d_wings.geo.json`), `loadCloak` (22×17 OptiFine cape layout, scaled by any integer; stacked frames for animated), `loadObj` (legacy OBJ hats). `enrich()` adds id/path/folder/ext/size/type/model fields; `ownerOf()` maps any file path to its owning item (used by All files). Dimensions are measured lazily from file headers via Range requests (`src/dimensions.ts`).
- `src/three/`: `geoModel.ts` (Bedrock geo → three groups with bones, per-cube epsilon inflate + polygonOffset to stop z-fighting), `animation/molang.ts` (small Molang interpreter incl. `lunar.*` from `cosmetics/functions.molang`; unknown identifiers evaluate to 0), `animation/bedrockAnim.ts` (AnimationPlayer; states idle/moving/elytra/gui), `sharedRenderer.ts` (ONE WebGL canvas with per-card scissor viewports; camera near/far 1–12 for depth precision), `fit.ts`.
- `src/filtering.ts` (pure): `Rule`/`SortKey`, `applyView(items, search, rules, sorts, fieldDefs)`; missing values sort last. UI is `components/FilterBar.vue` (PrimeVue Popovers).
- `src/views/ProviderView.vue` (sidebar + toolbar + grid, All files = `FileBrowser.vue`), `CosmeticModal.vue` (TrackballControls free rotation, field list, downloads), `CosmeticCard.vue`/`CosmeticGrid.vue`, `App.vue` (footer with stats from `src/stats.ts`).
- `worker/`: optional Cloudflare Worker proxy; deploy is the user's step (`VITE_CDN_BASE` points the app at it).

## Gotchas learned the hard way
- **CORS/download errors**: a plain `<img>` (no `crossorigin`) caches a non-CORS response; a later `fetch()` of the same URL then fails. Adding `crossorigin` afterwards fails against that stale cache instead. Fix in place: images are fetched with `getFileBuffer` and shown from `blob:` URLs (`blobUrl` in `lunar/index.ts`); downloads use the hash cache (or `fetch(blob:)`). Don't reintroduce direct CDN `<img src>` or `fetch(url)` for downloads.
- **PrimeVue overlays inside a Popover**: Select/MultiSelect/DatePicker panels teleport to `body`, which the Popover treats as an outside click and closes. Use `append-to="self"` on every overlay component inside a Popover.
- **Z-fighting** comes from coplanar/overlapping Bedrock cubes + `DoubleSide`. Don't remove the per-cube inflate, polygonOffset, or tight near/far.
- **Vue setup order**: `watch(..., { immediate: true })` runs during setup; anything it touches (`const`/`let`) must be declared above it or you get a TDZ blank page.
- **Windows encoding**: the Write/Edit tools or a Python rewrite once left `src/App.vue` non-UTF-8 and Vite failed with "stream did not contain valid UTF-8". When doing Python rewrites use `open(p, encoding='utf-8')` and `newline=''`. To find a bad file: loop `iconv -f utf-8 -t utf-8` over `src`. Git's LF→CRLF warnings are harmless.
- Heredocs containing lots of quotes/backticks can break in Bash; use the Write tool for big files.
- Route ids are category ids, not labels (wings = `dragon_wings`, cloaks = `cloak`, `all-files`, etc.). `/#/lunar/<id>`.

## Verifying UI without a browser session
`scripts/_cdp.mjs` drives headless Chrome (swiftshader, so WebGL works but is slow, icon fonts may render as boxes):

```
node scripts/_cdp.mjs "<url>" "<wait JS (async ok, truthy to stop)>" "<JS whose value is printed>" "<screenshot.png>" [w] [h] [timeoutSeconds]
```

Typical flow: start `npx vite --port 5199` in the background, wait ~5 s, run the script with URL `http://localhost:5199/#/lunar/cloak`, a wait expression that does `await new Promise(r=>setTimeout(r,5000))` then clicks things (`document.querySelector('.card').click()`, find buttons by `innerText`), then view the PNG with Read. Set `LOGS=1` to echo console output. Keep a single run under ~100 s (tool timeout is 120 s); kill node afterwards. Synthetic `.click()` works for PrimeVue buttons/options; for stubborn ones dispatch pointer/mouse events too. Real-GPU smoothness and drag interaction can't be verified this way — say so rather than claiming it.

## Conventions
- Match surrounding style: no semicolons, single quotes, 2-space indent, short comments explaining *why*.
- New fields for filtering: add to `CosmeticItem.fields` (catalog or `enrich()`), then expose in `lunarProvider.fields()` and, if user-visible, in `info()`.
- Persisted UI prefs use `localStorage` inside try/catch (`assetviewer.cols`, `assetviewer.sort.<provider>.<category>`).
- Known leftovers: main chunk ~1.5 MB; emote `.bobj` files are only listed/downloadable (no viewer); `moving`/`elytra` animations run with zero-speed inputs; Worker deploy is manual.
