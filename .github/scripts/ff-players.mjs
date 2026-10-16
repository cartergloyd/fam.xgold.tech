// Builds the slim player lookup the /ff/ page uses for names, positions and
// injury designations. Sleeper's full /players/nfl file is ~15 MB, so the page
// can't load it directly; this keeps fantasy-relevant players only.
//
//   node .github/scripts/ff-players.mjs <out.json> [sleeper-players.json]

import { readFile, writeFile } from 'node:fs/promises';

const [out, input] = process.argv.slice(2);
if (!out) throw new Error('usage: ff-players.mjs <out.json> [players.json]');

const raw = input
  ? JSON.parse(await readFile(input, 'utf8'))
  : await fetch('https://api.sleeper.app/v1/players/nfl', { headers: { 'User-Agent': 'fam.xgold.tech-ff' } }).then((r) => {
      if (!r.ok) throw new Error(`Sleeper players: HTTP ${r.status}`);
      return r.json();
    });

const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const players = {};
for (const [id, p] of Object.entries(raw)) {
  if (!p || !(p.active || p.team)) continue;
  if (!FANTASY.has(p.position) && !(p.fantasy_positions || []).some((x) => FANTASY.has(x))) continue;
  const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || id;
  // [name, position, team, injury status, injury body part]
  players[id] = [name, p.position || null, p.team || null, p.injury_status || null, p.injury_body_part || null];
}

const count = Object.keys(players).length;
if (count < 500) throw new Error(`Only ${count} players; refusing to publish a broken list`);
await writeFile(out, JSON.stringify({ updated: new Date().toISOString(), players }));
console.log(`Wrote ${count} players to ${out}`);
