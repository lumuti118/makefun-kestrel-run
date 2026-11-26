// Kestrel Run — the entrypoint that hands the game in. It copies game/ and
// screenshots/ from beside this file into the output directory and writes
// dossier.json, the summary the judge reads, using the vendored make.fun
// library. Node 22+, standard library only, no network, no timestamps and
// no randomness at run time, so two runs write byte-identical output.
//
// v2: the game is one classic script (game/game.js, loaded by a plain
// <script> tag), so game/index.html opens straight from file:// as well as
// from a server. This entrypoint refuses a stale layout — a leftover
// game/src directory or a missing game.js fails the build here, not at
// grading.
//
// Serve the game locally first with `node serve.ts`, then open
// http://localhost:8080. Outside the grader's container, MAKEFUN_OUTPUT_DIR
// stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// v2 layout guard: one classic script, no leftover module directory.
if (!existsSync(join(here, 'game', 'game.js'))) {
  throw new Error('missing game/game.js — the v2 single-script layout is incomplete');
}
if (existsSync(join(here, 'game', 'src'))) {
  throw new Error('stale game/src directory present — v2 ships game/game.js only');
}
// The file:// fix only works if index.html loads the classic script: a
// module tag would bring the CORS block back, so fail the build on it.
const entryHtml = readFileSync(join(here, 'game', 'index.html'), 'utf8');
if (!entryHtml.includes('<script src="./game.js">')) {
  throw new Error('game/index.html does not load ./game.js as a classic script');
}
if (entryHtml.includes('type="module"')) {
  throw new Error('game/index.html still uses a module script — file:// would be blocked');
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all, or a path under game/ over 1000 bytes: game/ counts
// beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`Kestrel Run dossier written to ${out}`);

// Build report: confirm the handed-in screenshots are all present and
// inside the scorer's per-file cap, so a bad capture fails here, not at grading.
const shotDir = join(out, 'screenshots');
const shots = existsSync(shotDir) ? readdirSync(shotDir).sort() : [];
let shotBytes = 0;
for (const name of shots) {
  const size = statSync(join(shotDir, name)).size;
  shotBytes += size;
  if (size > 262144) throw new Error(`screenshot over the 256 KiB cap: ${name} (${size} bytes)`);
}
const dossierBytes = statSync(join(out, 'dossier.json')).size;
console.log(`${shots.length} screenshots, ${shotBytes} bytes total; dossier.json ${dossierBytes} bytes`);
