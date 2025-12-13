# House of Van Bot (Cage Check)

Minimal Discord bot for role-based cage checks.

## Quick start
1) Install Node.js LTS from https://nodejs.org
2) Download this folder, copy `.env.example` to `.env`, and fill your IDs/tokens.
3) In a terminal inside the folder:
   ```bash
   npm install
   npm run register
   npm run dev
   ```

## Commands
- `/cagecheck request @sub duration reason` (Keyholder)
- `/cagecheck verify [photo]` (CagedSub)
- `/cagecheck history @sub` (Keyholder)
- `/cagecheck forgive @sub [count]` (Keyholder)
- `/cagecheck reset @sub` (Keyholder)
