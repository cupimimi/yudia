# Yudia

A Jellyfin client for **Samsung TVs / The Freestyle projector (Tizen)** and the **web** (laptop & phone),
built with React + TypeScript + Vite.

## Features

- Movies, TV shows (seasons, next episode, intro / credits skip), Live TV (IPTV), music (albums, artists,
  playlists, synced lyrics)
- Fully usable with a TV remote (spatial navigation), mouse, keyboard and touch
- Age rating & content warnings (EU scale), with optional [DoesTheDogDie](https://www.doesthedogdie.com) topics
- Website extras: phone layout, offline downloads & auto-downloads, Google Cast, lock-screen controls
- **Yudia Connect** (like Spotify Connect): see and control your other devices through Jellyfin's remote control

## ⚠️ What was replaced in this public copy

This repository is a cleaned copy of a personal project. Before using it, put **your own** values back:

| Placeholder | File | Replace with |
|---|---|---|
| `https://jellyfin.example.com` | `vite.config.ts` (`__YUDIA_DEFAULT_SERVER__`) | The address of **your** Jellyfin server, pre-filled in the TV build (the website build asks for it on first start) |
| `pi@raspberrypi` / `pi@192.168.1.50` | `scripts/deploy-web.ps1` | Your Raspberry Pi's `user@hostname` (or `user@IP`) for ssh |
| `192.168.1.60` | `scripts/install-freestyle.ps1` (example) | Your TV / Freestyle's IP address (pass it with `-DeviceIp`) |
| *(missing file)* `ddd-tagger/.env` | copy `ddd-tagger/.env.example` | `JELLYFIN_URL`, `JELLYFIN_API_KEY` (Jellyfin → Dashboard → API Keys), `DDD_API_KEY` (doesthedogdie.com profile) |
| *(missing file)* `/docker/.env` on the Pi | copy `pi-docker/.env.example` | `SLSKD_USERNAME` / `SLSKD_PASSWORD` (your Soulseek account, only if you use slskd) |
| `"freestyle"` certificate profile | `scripts/install-freestyle.ps1` (`-CertProfile`) | The name of your Samsung certificate profile in Tizen Studio |

Never commit real keys or passwords: `.env` files are ignored by git.

## Requirements

- Node.js 20+
- A Jellyfin server (tested with 10.10 – 12.x)
- For the TV: Tizen Studio / the Tizen extension and a Samsung certificate, TV in Developer Mode

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:3000 (a TV-style layout; narrow the window for the phone layout).

## Build

```bash
npm run build       # TV / Tizen → dist/   (then package as Yudia.wgt)
npm run build:web   # website → dist-web/  (upload the whole folder to any web host, https recommended)
```

Install on the TV / Freestyle: see `scripts/install-freestyle.ps1`. Publish the website to a Raspberry Pi
(nginx container from `pi-docker/`): `scripts/deploy-web.ps1`.

## Project layout

| Folder | What |
|---|---|
| `src/` | The app (components, services, players, navigation) |
| `public/` | Tizen package files (`config.xml`, icon) |
| `ddd-tagger/` | Optional Docker service that tags your library with DoesTheDogDie content warnings |
| `pi-docker/` | Example `docker-compose.yml` for a Raspberry Pi media server (Jellyfin, tagger, website…) |
| `scripts/` | Install / deploy helpers (PowerShell) |
| `design/` | Logo sources |

## Notes

- Jellyfin 12 only accepts the `ApiKey=` query parameter (not the old `api_key=`) for the WebSocket and API
  calls — this app uses `ApiKey` everywhere.
- Downloads, Google Cast and the offline app are website-only; the TV app streams.
