// Local preview of the pre-drop announcement.
// Usage: node scripts/preview-announce.mjs
// Renders exactly what executeAnnounce would post: caption text + banner PNG.
// No bot calls, no group posting.

import { formatDropAnnouncement } from '../dist/game/messages.js';
import { generateBannerPNG } from '../dist/game/banner.js';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Scenario: next scheduled drop on Mon 2026-04-13 at 16:00 UTC ---
const dropRunAt = new Date('2026-04-13T16:00:00Z');
const now = new Date();                // "now" for the Today/Tomorrow label
const totalDays = 30;                  // matches getTotalDays()
const resolveDelayMin = 120;           // matches /setresolvedelay 120

// 1. Caption
const caption = formatDropAnnouncement(dropRunAt, now, totalDays);
console.log('─────────────── CAPTION ───────────────');
console.log(caption);
console.log('───────────────────────────────────────');

// 2. Banner PNG
const buf = await generateBannerPNG(resolveDelayMin);
const out = join(tmpdir(), 'carbon-roulette-announce-preview.png');
writeFileSync(out, buf);
console.log(`\nbanner saved to: ${out}`);
console.log(`open it with:    open "${out}"`);
