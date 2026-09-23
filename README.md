# House of Van Bot (Cage Check)

Discord bot for role-based cage checks.

## Quick start
1) Install Node.js 20 or newer.
2) Download this folder, copy `.env.example` to `.env`, and fill your IDs/tokens.
3) In a terminal inside the folder:
   ```bash
   npm install
   npm run register
   npm run dev
   ```

Run `npm run register` whenever the slash-command definition changes.

## Commands
- `/cagecheck request @sub duration reason` (Keymaster)
- `/cagecheck verify [photo]` (CagedSub)
- `/cagecheck history @sub` (Keyholder)
- `/cagecheck forgive @sub [count]` (Keyholder)
- `/cagecheck reset @sub` (Keyholder)
- `/health`

## Discord configuration

In the Developer Portal, enable **Server Members Intent** under Bot > Privileged Gateway Intents. Install the bot with the `bot` and `applications.commands` scopes.

In the cage-check and log channels, give the bot View Channel, Send Messages, Read Message History, Create Public Threads, Send Messages in Threads, Manage Threads, and Manage Messages. The bot's role must sit above the CagedSub role so it can remove that role after three misses.

Use the bot token from the Bot page for `DISCORD_TOKEN`; do not use the client secret. IDs require Discord Developer Mode and **Copy ID**. All variables are documented in `.env.example`.

## Docker / Portainer

GitHub Actions publishes `ghcr.io/vantoetsenbord/cagecheck-discord-bot:latest` whenever `main` changes. The Compose stack can pull that image (or build locally) and stores `data/*.json` in the persistent `cagecheck-data` volume. In Portainer, add the required values under **Environment variables**. For local Docker Compose, place `.env` beside `docker-compose.yml`, then run `docker compose up -d --build`.

Register commands once from a trusted machine with the same `.env` by running `npm run register`. The running container does not re-register commands on every restart.
