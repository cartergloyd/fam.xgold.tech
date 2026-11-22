// Builds the price history the /ff/ page's League Funds chart is drawn from:
// a year of daily closes for each stock the league holds.
//
//   node .github/scripts/ff-funds.mjs <out.json> <TICKER> [TICKER...]

import { writeFile } from 'node:fs/promises';

const [out, ...tickers] = process.argv.slice(2);
if (!out || !tickers.length) throw new Error('usage: ff-funds.mjs <out.json> <TICKER> [TICKER...]');

const day = (seconds, offset) => new Date((seconds + offset) * 1000).toISOString().slice(0, 10);

async function closes(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'funds-chart/1.0' } });
  if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
  const result = (await res.json())?.chart?.result?.[0];
  const stamps = result?.timestamp || [], prices = result?.indicators?.quote?.[0]?.close || [];
  const offset = result?.meta?.gmtoffset || 0;   // stamps are the exchange's opening bell; this keeps the exchange's date
  const rows = stamps.map((t, i) => [day(t, offset), prices[i]])
    .filter(([, p]) => Number.isFinite(p) && p > 0)
    .map(([d, p]) => [d, Math.round(p * 100) / 100]);
  if (rows.length < 20) throw new Error(`${ticker}: only ${rows.length} days of prices; refusing to publish`);
  return rows;
}

const series = {};
for (const t of tickers) series[t] = await closes(t);
await writeFile(out, JSON.stringify({ updated: new Date().toISOString(), series }));
console.log(tickers.map((t) => `${t}: ${series[t].length} days to ${series[t].at(-1)[0]}`).join(', '));
