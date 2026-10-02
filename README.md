# assetviewer

A feature-rich unofficial non-affiliated asset viewer for the cosmetic providers we previously developed patches for,
such as [Lunar Client](https://github.com/prometheusreengineering/minecraft-lunar) and
[Essential Mod](https://github.com/prometheusreengineering/minecraft-essential) (coming soon).

[![Discord](https://img.shields.io/discord/1197794960985043034?style=for-the-badge&label=Discord&color=rgb(88%2C%20101%2C%20242)%20)](https://discord.gg/BFDWmPfmXg)

## Features

- Browses ALL cosmetics, emotes and resources on Lunar Client's public asset CDN (6,500+ items).
- Previews every cosmetic in 3D: hats, cloaks, wings, pets, suits, auras and more, with their animations.
- Plays emotes on a player, including props and particle effects.
- Shows cosmetics on a player with any Minecraft skin, alone or as a full outfit in the outfit builder.
- Search, filter and sort on any field, with the view kept in the URL so it can be shared.
- Collections, side-by-side compare and ZIP export of the source files.
- Runs entirely in the browser; downloaded files are cached locally.

### Future Plans

- Essential Mod cosmetics.
- Slim (Alex) player arms.

## Development

Requires Node.js 20.19+ or 22.12+ (Vite 8).

```sh
npm install
npm run dev     # dev server
npm run build   # type check + production build in dist/
```

The build reads a `PRIMEUI_LICENSE` key from a `.env` file in the project root (never commit it).

### Deployment

Hosted on Cloudflare Pages at [assetviewer.dreamys.studio](https://assetviewer.dreamys.studio), built from `main` through the Git integration
(build command `npm run build`, output directory `dist`, `PRIMEUI_LICENSE` set as a secret in the Pages project).

## Disclaimer

This project is intended for educational purposes only. We are not responsible for any damage caused by this project.
Assets belong to their respective owners. This project is not affiliated with Lunar Client or Moonsworth.

This project was made almost entirely with Claude Opus 5.5 on Medium/High effort.

## License

GPLv3 © Prometheus Reengineering
