# assetviewer

A feature-rich unofficial non-affiliated asset viewer for the cosmetic providers we previously developed patches for,
such as [Lunar Client](https://github.com/prometheusreengineering/minecraft-lunar) and
[Essential Mod](https://github.com/prometheusreengineering/minecraft-essential), plus Dawn Client.

[![Discord](https://img.shields.io/discord/1197794960985043034?style=for-the-badge&label=Discord&color=rgb(88%2C%20101%2C%20242)%20)](https://discord.gg/BFDWmPfmXg)

## Features

- Browses ALL cosmetics, emotes and resources on Lunar Client's public asset CDN (6,500+ items), and every cosmetic on
  Dawn Client's asset CDN (860+ items, with animated textures).
- Shows Essential Mod cosmetics from your own installation: pick your `.minecraft` folder and the cosmetic dumps
  (written by the Prometheus patch) and Essential Mod's cosmetic cache are read locally in your browser. Nothing of
  Essential Mod is hosted here and nothing is uploaded. Glow layers, animated textures, colour variants, sides, skin
  masks, particle effects, and emotes with their sounds are all shown.
- Previews every cosmetic in 3D: hats, cloaks, wings, pets, suits, auras and more, with their animations.
- Plays emotes on a player, including props and particle effects.
- Shows cosmetics on a player with any Minecraft skin (wide or slim arms), alone or as a full outfit in the outfit builder.
- Search, filter and sort on any field, with the view kept in the URL so it can be shared.
- Collections, side-by-side compare and ZIP export of the source files.
- Essential Mod outfits follow Essential Mod's own rules: items that can't be worn together, parts hidden by other
  cosmetics or by armor (drawn stand-in pieces, in any of Essential Mod's three armor modes), and any Essential Mod emote as
  the pose.
- Runs entirely in the browser; downloaded files are cached locally.


## Development

Requires Node.js 20.19+ or 22.12+ (Vite 8).

```sh
npm install
npm run dev     # dev server
npm run build   # type check + production build in dist/
```

The build reads a `PRIMEUI_LICENSE` key from a `.env` file in the project root (never commit it).

### Tests

Tests use [Vitest](https://vitest.dev) in three projects:

- **unit** (`tests/unit`, Node): parsers, catalog, geometry and other pure logic, run against a small fixture CDN.
  `tests/unit/live` checks the real Lunar Client and Dawn Client CDNs (needs network, about a minute).
- **dom** (`tests/dom`, happy-dom): Vue components and the whole app on the fixture CDN, with WebGL faked.
- **browser** (`tests/browser`, Chromium through Playwright): real WebGL rendering, Cache Storage and live models.
  Run `npx playwright install chromium` once before the first run.

```sh
npm test                 # all projects
npm run test:unit        # or test:dom / test:browser for one project
npm run test:watch       # rerun on change
npm run test:coverage    # code coverage report in coverage/
```

`node scripts/coverage.mjs` checks catalog coverage: it sorts every file in the CDN indexes into an item, a dependency of an item,
or a resource, and prints `UNCLAIMED 0` (exit code 1 otherwise). Run it after changing `src/providers/lunar/catalog.ts`.

GitHub Actions (`.github/workflows/ci.yml`) runs the type check and all tests with code coverage on every push (any branch or tag),
on pull requests from forks and on manual runs, and uploads the coverage report as a build artifact. When the exact same files
already passed (a merge of an up-to-date branch, a release tag on a tested commit), the tests are skipped.

### Deployment

Hosted on Cloudflare Workers (static assets) at [assetviewer.prometheusreengineer.ing](https://assetviewer.prometheusreengineer.ing).
Pushes to `main` don't deploy: a release is a `v*` tag on a commit of `main`, deployed by the CI's `deploy` job once the tests pass
(`npm run build`, then `wrangler deploy` with `wrangler.jsonc`):

```sh
git tag v1.2.3
git push --atomic origin main v1.2.3
```

Every other branch gets a preview at `<branch>-assetviewer.<subdomain>.workers.dev` once its tests pass (link in the run summary);
previews never touch production. The workflow needs the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `PRIMEUI_LICENSE`.
The site is static except `worker/`, which proxies `/dawn/*` to Dawn Client's asset CDN (it sends no CORS headers); `npm run dev` does
the same through the Vite dev server.

## Disclaimer

This project is intended for educational purposes only. We are not responsible for any damage caused by this project.

Assets belong to their respective owners. This project is not affiliated with Lunar Client, Moonsworth, Dawn Client, Essential Mod or ModCore.

This project was made almost entirely with Claude Opus 5.5 on Medium/High effort.

## License

GPLv3 © Prometheus Reengineering
