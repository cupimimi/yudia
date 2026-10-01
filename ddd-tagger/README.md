# Jellyfin DDD tagger

Adds content warnings from **DoesTheDogDie.com** to your Jellyfin movies and series as tags
(`ddd:violence`, `ddd:flashing lights`, …). The TV app shows them in the age-rating popup and turns
flashing-light / seizure topics into the photosensitive warning. Runs once a day; new media is tagged
on the next run without anything to do.

*Powered by DoesTheDogDie.com* — free API tier: non-commercial use only, attribution required
(the TV app shows it whenever DDD data is on screen).

## Install on the Raspberry Pi (Docker)

Works on 64-bit (arm64) and 32-bit (armv7) Raspberry Pi OS. The Pi Zero / Pi 1 (armv6) aren't supported by Node 22.

From Windows (PowerShell), copy the folder to the Pi:

```powershell
scp -r "path\to\yudia\ddd-tagger" pi@<PI-IP>:~/
```

On the Pi (`ssh pi@<PI-IP>`):

```bash
cd ~/ddd-tagger
cat .env                     # keys filled in, JELLYFIN_URL=http://127.0.0.1:8096
docker compose run --rm -e RUN_ONCE=true -e DRY_RUN=true ddd-tagger   # test: prints, writes nothing
docker compose up -d --build                                          # real: now, then every 24 h
docker logs -f jellyfin-ddd-tagger
```

`network_mode: host` lets the container reach Jellyfin at `127.0.0.1:8096` on the Pi, bypassing Cloudflare.
If Jellyfin isn't on the Pi itself, set `JELLYFIN_URL` to its LAN address (e.g. `http://192.168.1.20:8096`).

## How it works

1. Lists all movies and series in Jellyfin.
2. Skips titles checked in the last `RECHECK_DAYS` (tag `ddd:checked:YYYY-MM-DD`).
3. Finds the title on DDD by IMDb id → TMDB id → exact name + year.
4. Keeps topics with ≥ `MIN_YES_VOTES` yes votes and ≥ `MIN_YES_RATIO` yes share.
5. Replaces only the `ddd:` tags on the item; your own tags are never touched.

Budget: 1 request per run + 2 per new title. The free tier allows 5,000/month and 30/min; the script
paces itself (~2 s between calls) and stops `DDD_MONTHLY_RESERVE` requests before the monthly cap.

To remove everything: stop the container and delete tags starting with `ddd:` in Jellyfin
(or set `MAX_TOPICS_PER_TITLE=0`, `RECHECK_DAYS=0`, run once — that leaves only the checked marker).
