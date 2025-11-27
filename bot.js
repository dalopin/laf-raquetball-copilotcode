const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function loadConfig(configPath) {
  const p = path.resolve(configPath);
  if (!fs.existsSync(p)) {
    console.error(`Config file not found: ${p}`);
    console.error('Copy `config/selectors.example.json` to `config/selectors.json` and update selectors for the site.');
    process.exit(1);
  }
  return require(p);
}

function log(...args) { console.log(new Date().toISOString(), ...args); }

async function main() {
  const RESERVATION_URL = process.env.RESERVATION_URL || 'https://lafitness.com/Pages/RacquetballReservation.aspx';
  const CONFIG_PATH = process.env.CONFIG_PATH || './config/selectors.json';
  const USER = process.env.RB_USER;
  const PASS = process.env.RB_PASS;
  const LOCATION_NAME = process.env.LOCATION_NAME || 'Jamboree';
  const COURT_NUMBER = process.env.COURT_NUMBER ? Number(process.env.COURT_NUMBER) : null;
  const HEADLESS = process.env.HEADLESS !== 'false';

  const config = await loadConfig(CONFIG_PATH);

  log('Launching browser (headless=', HEADLESS, ')');
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Optional login flow from config
    if (config.login && config.login.loginUrl) {
      if (!USER || !PASS) {
        console.error('RB_USER and RB_PASS environment variables are required for login.');
        process.exit(1);
      }
      log('Navigating to login url');
      await page.goto(config.login.loginUrl, { waitUntil: 'networkidle' });
      if (config.login.usernameSelector && config.login.passwordSelector) {
        log('Filling credentials');
        await page.fill(config.login.usernameSelector, USER);
        await page.fill(config.login.passwordSelector, PASS);
      } else {
        console.warn('Login selectors not fully specified in config; please update `config/selectors.json`.');
      }
      if (config.login.submitSelector) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
          page.click(config.login.submitSelector).catch(() => {})
        ]);
        log('Login attempted');
      } else {
        log('No submitSelector provided; please submit the form manually or update config.');
      }
    }

    log('Navigating to reservation page:', RESERVATION_URL);
    await page.goto(RESERVATION_URL, { waitUntil: 'networkidle' });

    // Select location if config provides a selector
    if (config.location && config.location.selectSelector) {
      log('Selecting location:', LOCATION_NAME);
      try {
        // try to select option by label/value
        const sel = config.location.selectSelector;
        const success = await page.evaluate(({ sel, LOCATION_NAME }) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          // try option by exact text
          for (const opt of Array.from(el.options || [])) {
            if (opt.text.trim().toLowerCase() === LOCATION_NAME.trim().toLowerCase()) {
              el.value = opt.value; el.dispatchEvent(new Event('change')); return true;
            }
          }
          // fallback: try selectOption via Playwright later
          return false;
        }, { sel: config.location.selectSelector, LOCATION_NAME });
        if (!success) {
          await page.selectOption(config.location.selectSelector, { label: LOCATION_NAME }).catch(() => {});
        }
        await page.waitForTimeout(1000);
      } catch (e) {
        console.warn('Could not select location automatically:', e.message);
      }
    } else if (config.location && config.location.locatorTextSelector) {
      log('Clicking location text element');
      try {
        await page.click(config.location.locatorTextSelector.replace('__LOCATION__', LOCATION_NAME));
      } catch (e) { console.warn('Click by text failed:', e.message); }
    } else {
      log('No location selector provided in config; ensure page is filtered to desired location manually or update config.');
    }

    // Wait for slots container
    if (!config.slot || !config.slot.itemSelector) {
      console.error('Missing slot.itemSelector in config/selectors.json. Please update the config.');
      process.exit(1);
    }

    log('Waiting for slot items...');
    await page.waitForSelector(config.slot.itemSelector, { timeout: 10000 });
    const items = await page.$$(config.slot.itemSelector);
    log('Found', items.length, 'slot items');

    if (items.length === 0) {
      log('No slots available at this time.');
      await browser.close();
      process.exit(0);
    }

    // Parse date/time/court metadata for each slot using configurable attributes or regex
    const parsedSlots = [];
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const meta = await el.evaluate((node) => {
        return {
          text: node.innerText || '',
          // include common attributes if present
          dataDate: node.getAttribute('data-date') || null,
          dataTime: node.getAttribute('data-time') || null,
          dataCourt: node.getAttribute('data-court') || null
        };
      });

      // Try to extract using config rules
      let dateStr = meta.dataDate || null;
      let timeStr = meta.dataTime || null;
      let courtStr = meta.dataCourt || null;

      if (!dateStr && config.slot.dateAttribute) {
        try { dateStr = await el.getAttribute(config.slot.dateAttribute); } catch (e) { dateStr = null; }
      }
      if (!timeStr && config.slot.timeAttribute) {
        try { timeStr = await el.getAttribute(config.slot.timeAttribute); } catch (e) { timeStr = null; }
      }
      if (!courtStr && config.slot.courtAttribute) {
        try { courtStr = await el.getAttribute(config.slot.courtAttribute); } catch (e) { courtStr = null; }
      }

      // Build a node to parse in Node (avoid heavy parsing in page.evaluate)
      parsedSlots.push({ index: i, text: meta.text, dateStr, timeStr, courtStr });
    }

    // Helper parsers
    function parseDate(s) {
      if (!s) return null;
      // Try ISO parse
      const d = new Date(s);
      if (!isNaN(d)) return d;
      // Try regex from config
      if (config.slot.dateRegex) {
        try {
          const rx = new RegExp(config.slot.dateRegex);
          const m = s.match(rx);
          if (m && m[0]) return new Date(m[0]);
        } catch (e) {}
      }
      // Last resort: try to pull date-like substring
      const m = s.match(/\w+ \d{1,2},? \d{4}/);
      if (m) return new Date(m[0]);
      return null;
    }

    function parseTime(s) {
      if (!s) return null;
      // Try HH:MM AM/PM
      const m = s.match(/(\d{1,2}:\d{2}\s*(AM|PM|am|pm))/);
      if (m) return m[1];
      // Try 24h
      const m2 = s.match(/(\d{1,2}:\d{2})/);
      if (m2) return m2[1];
      // regex from config
      if (config.slot.timeRegex) {
        try {
          const rx = new RegExp(config.slot.timeRegex);
          const mm = s.match(rx);
          if (mm && mm[0]) return mm[0];
        } catch (e) {}
      }
      return null;
    }

    function parseCourt(s) {
      if (!s) return null;
      const m = s.match(/\bCourt\s*(\d+)\b/i) || s.match(/#(\d+)/);
      if (m) return Number(m[1]);
      if (config.slot.courtRegex) {
        try {
          const rx = new RegExp(config.slot.courtRegex);
          const mm = s.match(rx);
          if (mm && mm[1]) return Number(mm[1]);
        } catch (e) {}
      }
      if (/^\d+$/.test(s)) return Number(s);
      return null;
    }

    const slotsWithParsed = parsedSlots.map(s => {
      const date = parseDate(s.dateStr || s.text);
      const time = parseTime(s.timeStr || s.text);
      const court = parseCourt(s.courtStr || s.text);
      return { ...s, date, time, court };
    }).filter(s => s.date || s.time);

    if (slotsWithParsed.length === 0) {
      log('No parsable slots found. Please update `config/selectors.json` with appropriate attributes or regex to extract date/time/court.');
      await browser.close();
      process.exit(2);
    }

    // Select furthest available day (max date), then earliest time on that day
    // If date missing, treat as same-day candidates and keep original order
    let chosenSlot = null;
    const withDates = slotsWithParsed.filter(s => s.date instanceof Date && !isNaN(s.date));
    if (withDates.length > 0) {
      // group by date-only (ignore time)
      const byDay = {};
      for (const s of withDates) {
        const dayKey = s.date.toISOString().slice(0,10);
        byDay[dayKey] = byDay[dayKey] || [];
        byDay[dayKey].push(s);
      }
      const dayKeys = Object.keys(byDay).sort();
      const furthestDayKey = dayKeys[dayKeys.length - 1];
      const candidates = byDay[furthestDayKey];
      // pick earliest time among candidates
      candidates.sort((a,b) => {
        if (!a.time) return 1; if (!b.time) return -1;
        const ta = a.time.replace(/\s+/g,''); const tb = b.time.replace(/\s+/g,'');
        return ta.localeCompare(tb, undefined, {numeric:true});
      });
      // prefer requested court if provided
      if (COURT_NUMBER) {
        const found = candidates.find(c => c.court === COURT_NUMBER);
        chosenSlot = found || candidates[0];
      } else {
        chosenSlot = candidates[0];
      }
    } else {
      // no dates: fallback to choosing earliest by time in whole list
      slotsWithParsed.sort((a,b) => {
        if (!a.time) return 1; if (!b.time) return -1;
        return a.time.localeCompare(b.time, undefined, {numeric:true});
      });
      if (COURT_NUMBER) chosenSlot = slotsWithParsed.find(s => s.court === COURT_NUMBER) || slotsWithParsed[0];
      else chosenSlot = slotsWithParsed[0];
    }

    if (!chosenSlot) {
      log('No suitable slot matched preferences (court or parsing).');
      await browser.close();
      process.exit(2);
    }

    log('Chosen slot index:', chosenSlot.index, 'date:', chosenSlot.date, 'time:', chosenSlot.time, 'court:', chosenSlot.court);

    // Attempt to click the book button inside chosen slot
    let booked = false;
    try {
      const targetEl = items[chosenSlot.index];
      if (config.slot.bookButtonSelector) {
        const btn = await targetEl.$(config.slot.bookButtonSelector) || await page.$(config.slot.bookButtonSelector);
        if (!btn) throw new Error('Book button not found for chosen slot');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
          btn.click().catch(() => {})
        ]);
      } else {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
          targetEl.click().catch(() => {})
        ]);
      }

      if (config.confirmationSelector) {
        await page.waitForSelector(config.confirmationSelector, { timeout: 8000 });
        log('Booking confirmed (selector matched).');
      } else {
        log('Booking attempted — no confirmationSelector configured; please verify on the site.');
      }
      booked = true;
    } catch (e) {
      console.warn('Attempt to book chosen slot failed:', e.message);
    }

    if (!booked) {
      log('No slot could be booked automatically. Please inspect selectors and try again.');
    }

    await browser.close();
    if (booked) process.exit(0);
    else process.exit(2);
  } catch (err) {
    console.error('Unhandled error:', err);
    await browser.close();
    process.exit(3);
  }
}

main();
