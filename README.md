# laf-raquetball-bot

This repository contains a configurable Playwright-based bot to attempt booking a racquetball court at the earliest available time for a given location (e.g. "Jamboree").

IMPORTANT: Before using the bot, confirm you have permission to automate interactions with the target website and that automating does not violate its terms of service. The author is responsible for compliance.

Quick start (local)

1. Install dependencies

```bash
npm ci
npx playwright install
```

2. Copy the example config and update selectors

```bash
cp config/selectors.example.json config/selectors.json
# Edit config/selectors.json and fill real selectors for login, location dropdown, slot items and book button
```

3. Set environment variables (example)

```bash
export RB_USER="your-username"
export RB_PASS="your-password"
export LOCATION_NAME="Jamboree"
# Optional: request a specific court number (e.g. 2)
export COURT_NUMBER="2"
# Optionally override the reservation URL
export RESERVATION_URL="https://lafitness.com/Pages/RacquetballReservation.aspx"
```

4. Run the bot

```bash
node src/bot.js
```

How it works (high level)
- The bot is intentionally configuration-driven: selectors are kept in `config/selectors.json` so you can inspect the site and provide stable selectors rather than hard-coding brittle values.
- If the `login` section is present in the config, the bot will attempt to log in using `RB_USER`/`RB_PASS`.
- The bot attempts to narrow to the specified `LOCATION_NAME`, then finds slot elements (by `slot.itemSelector`) and attempts to click the first book button it can.
 - The bot will choose the furthest available day and then the earliest time on that day. If you set `COURT_NUMBER`, it will prefer that court on the chosen day when possible.

Render.com deployment notes
- Connect this GitHub repo to Render.
- Create a **Cron Job** (or Background Worker) in Render to run the command:

```bash
npm ci && npx playwright install && node src/bot.js
```

- Set environment variables in Render (RB_USER, RB_PASS, LOCATION_NAME, RESERVATION_URL if needed).
- Use a reasonable schedule (e.g., daily at 6:00am) and make sure to test manually first.

Using `render.yaml` (Infrastructure as Code)
- This repo includes a `render.yaml` that defines a cron job named `racquetball-booker-cron`. You can use it to create the job automatically from Render's Dashboard by connecting the repo and allowing Render to import the service.
- Default `render.yaml` schedule is `0 14 * * *` (14:00 UTC) — adjust it in Render to match your preferred time zone. Render interprets the cron schedule in UTC.
- The `render.yaml` declares these env var keys: `RB_USER`, `RB_PASS`, `LOCATION_NAME`, `COURT_NUMBER`. For security, set their values in the Render dashboard (do not commit secrets).

Manual Render Cron creation (if you prefer UI)
1. In Render, create a new **Cron Job**.
2. Repository: select this GitHub repo and the branch (e.g., `main`).
3. Build command: `npm ci && npx playwright install`
4. Start command: `node src/bot.js`
5. Schedule: set your cron expression (Render uses UTC). For example, use daily at 14:00 UTC to approximate 6:00 AM Pacific.
6. Add environment variables in the Render UI: `RB_USER`, `RB_PASS`, `LOCATION_NAME`, `COURT_NUMBER`.

Security note
- Never add secrets to `render.yaml` — set values via Render's web UI or secret store.

Selector discovery tips
- Open your browser's developer tools, locate the login form and reservation page elements, then copy unique CSS selectors or XPath.
- Prefer stable IDs or data-attributes over text that may change.

Interactive helper: capture slot HTML
- There's a helper script to open the reservation page in a headed browser and print representative slot HTML. Run it, navigate to the reservation slots (enter zipcode `92780` and select `IRVINE - JAMBOREE`), then press Enter in the terminal to dump sample elements.

```bash
npm run inspect
# or provide a selector to try first:
ITEM_SELECTOR=".your-slot-class" npm run inspect
```

Paste one or two of the printed element outerHTML blocks here and I'll craft a `config/selectors.json` for you.

Next steps
- Run the bot locally, capture real selectors and update `config/selectors.json`.
- After successful local tests, create a Render Cron Job and provide credentials via Render's Environment panel.

Security & safety
- Never commit `config/selectors.json` containing credentials. Use environment variables for secrets.
- If the site uses CAPTCHA or other bot-detection, this bot will fail; do not attempt to bypass CAPTCHA.
