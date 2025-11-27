const fs = require('fs');
const { chromium } = require('playwright');
const readline = require('readline');

const RESERVATION_URL = process.env.RESERVATION_URL || 'https://lafitness.com/Pages/RacquetballReservation.aspx';
const SELECTOR_CANDIDATES = (process.env.ITEM_SELECTOR || '.slot-item,.slot,.time-slot,.available,.reservation-row,.reservation-slot').split(',');
const MAX = Number(process.env.MAX || 5);

function askEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function dumpOuterHTML(page, selector, limit) {
  const els = await page.$$(selector);
  const out = [];
  for (let i = 0; i < Math.min(els.length, limit); ++i) {
    const html = await els[i].evaluate(n => n.outerHTML);
    out.push(html);
  }
  return out;
}

async function main() {
  console.log('Starting Playwright (headed). The browser will open and navigate to the reservation page.');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(RESERVATION_URL).catch(e => console.error('Navigate error:', e.message));

  console.log('\nInstructions:')
  console.log('- In the opened browser, if needed, enter zipcode 92780 and select the location "IRVINE - JAMBOREE" so the reservation slots are visible.');
  console.log('- When the page shows the slot listings you want to capture, return to this terminal and press Enter.');

  await askEnter('\nPress Enter after the page shows slots... ');

  let foundAny = false;
  for (const sel of SELECTOR_CANDIDATES) {
    try {
      const list = await dumpOuterHTML(page, sel, MAX);
      if (list.length > 0) {
        foundAny = true;
        console.log(`\n--- Found ${list.length} element(s) with selector: ${sel}`);
        list.forEach((html, idx) => {
          console.log(`\n---- Element ${idx + 1} (selector: ${sel}):\n${html}\n`);
        });
      }
    } catch (e) {
      // ignore
    }
  }

  if (!foundAny) {
    console.log('\nNo common selectors matched. You can run this script again with a custom selector via ITEM_SELECTOR env var.');
    console.log('Example: ITEM_SELECTOR=".your-slot-class" node src/inspect_selectors.js');
  }

  console.log('\nDone. Close the browser window to exit.');
  // keep process alive until user closes browser so they can inspect, or close here
  // await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
