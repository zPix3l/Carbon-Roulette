/**
 * Round-by-round consistency audit — run with `npx tsx scripts/audit-projects.ts`
 *
 * Re-checks every project in projects.json against the encoded rules in
 * datasets.ts (the source of truth). It does NOT regenerate anything; it only
 * reports whether each round's isLegit verdict is logically consistent with the
 * project's own attributes.
 *
 * Failure modes it catches:
 *   - LEGIT project that actually contains a real, machine-checkable violation
 *     (→ the "correct answer" should have been SCAM).
 *   - SCAM project with no detectable red flag at all (→ verdict unjustified).
 *   - SCAM project whose declared violation is real, but which ALSO carries an
 *     extra unflagged contradiction (muddies which red flag is "the" one).
 *
 * Fraud-pattern violations live in prose and can't be machine-verified, so a
 * scam that declares a FRAUD_PATTERN is trusted as justified.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  METHODS, SCOPE_MATRIX, STANDARD_NAMES,
  IMPOSSIBLE_COUNTRIES, COUNTRY_BIOME, METHODOLOGY_CONSTRAINTS,
  type MethodId, type StandardId, type YieldRange,
} from '../src/projects/datasets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Violation { type: string; field: string; explanation: string; }
interface Project {
  id: number; day: number; name: string; country: string;
  method: MethodId; methodName: string;
  standard: string; standardId: StandardId; methodologyId: string;
  volume: number; price: number; yield?: number; yieldUnit?: string; area?: number;
  isLegit: boolean; violations: Violation[]; difficulty: number;
}

const projects: Project[] = JSON.parse(
  readFileSync(resolve(__dirname, '../src/projects/projects.json'), 'utf-8'),
);

// Mirror of generator.pickYieldRangeForCountry
function pickYieldRangeForCountry(method: MethodId, country: string): YieldRange {
  const m = METHODS[method];
  if (m.yieldRanges.length <= 1) return m.yieldRanges[0];
  const biome = COUNTRY_BIOME[country];
  if (biome) {
    const match = m.yieldRanges.find(yr => yr.biome === biome);
    if (match) return match;
  }
  return m.yieldRanges[0];
}

// Is this methodology ID known to belong to the method (under ANY standard)?
function methodologyBelongsToMethod(method: MethodId, id: string): boolean {
  const byStd = METHODS[method].methodologyIds;
  return Object.values(byStd).some(ids => ids?.includes(id));
}

// Under which method(s) does this methodology ID actually live? (for diagnostics)
function homeMethodsOf(id: string): MethodId[] {
  const out: MethodId[] = [];
  for (const m of Object.keys(METHODS) as MethodId[]) {
    if (methodologyBelongsToMethod(m, id)) out.push(m);
  }
  return out;
}

interface Problem { code: string; detail: string; }

// Region-bound name prefixes (from PROJECT_NAME_PARTS) → countries where the place
// actually is. A LEGIT round whose title names a place on the wrong continent from its
// stated country reads as fabricated: players intuitively distrust it and flag it as a
// scam, so a valid project "fails" in their eyes. The structured-field rules miss this
// because the clash lives in the free-text name, not a checked field. (This is the class
// Parag caught on "Borneo Cropland …/Brazil" and "Congo Planting …/China".)
const GEO_PREFIX_COUNTRIES: Record<string, string[]> = {
  Cerrado: ['Brazil'],
  Mekong: ['Vietnam', 'Cambodia', 'Thailand', 'Laos', 'Myanmar'],
  Andes: ['Peru', 'Chile', 'Colombia', 'Ecuador', 'Bolivia', 'Argentina'],
  Borneo: ['Indonesia', 'Malaysia', 'Brunei'],
  Congo: ['DRC', 'Republic of the Congo'],
  Sahel: ['Mali', 'Niger', 'Chad', 'Sudan', 'Senegal', 'Burkina Faso', 'Nigeria'],
  Nordic: ['Sweden', 'Norway', 'Finland', 'Iceland', 'Denmark'],
  Cascade: ['United States', 'Canada'],
};

function nameGeoProblem(p: Project): Problem | null {
  const prefix = p.name.split(' ')[0];
  const allowed = GEO_PREFIX_COUNTRIES[prefix];
  if (allowed && !allowed.includes(p.country)) {
    return { code: 'NAME_GEOGRAPHY', detail: `name "${p.name}" implies ${allowed.join('/')}, but the project is in ${p.country}` };
  }
  return null;
}

function hardProblems(p: Project): Problem[] {
  const probs: Problem[] = [];
  const m = METHODS[p.method];

  // 1. Scope matrix: standard explicitly does NOT certify this method
  const compat = SCOPE_MATRIX[p.method][p.standardId];
  if (compat === 'NO') {
    probs.push({ code: 'WRONG_STANDARD', detail: `${STANDARD_NAMES[p.standardId]} does not certify ${p.methodName} (scope matrix = NO)` });
  }

  // 2. Methodology must belong to this method
  if (p.methodologyId && p.methodologyId !== 'N/A' && !methodologyBelongsToMethod(p.method, p.methodologyId)) {
    const home = homeMethodsOf(p.methodologyId);
    probs.push({ code: 'WRONG_METHODOLOGY_ID', detail: `${p.methodologyId} is not a ${p.methodName} methodology${home.length ? ` (belongs to ${home.map(h => METHODS[h].name).join('/')})` : ''}` });
  }

  // 3. Methodology applicability constraint (geography)
  const c = METHODOLOGY_CONSTRAINTS[p.methodologyId];
  if (c?.countries && !c.countries.includes(p.country)) {
    probs.push({ code: 'METHODOLOGY_SCOPE', detail: `${p.methodologyId} not applicable in ${p.country} — ${c.reason} (allowed: ${c.countries.join(', ')})` });
  }

  // 4. Impossible country for this method/biome
  if (IMPOSSIBLE_COUNTRIES[p.method].includes(p.country)) {
    probs.push({ code: 'WRONG_COUNTRY', detail: `${p.methodName} not viable in ${p.country}` });
  }

  // 5. Price out of documented range
  if (p.price < m.priceRange.min || p.price > m.priceRange.max) {
    probs.push({ code: 'PRICE_OUT_OF_RANGE', detail: `$${p.price} outside $${m.priceRange.min}–${m.priceRange.max}` });
  }

  // 6. Yield out of biome range (only when the project carries a per-area/unit yield)
  if (p.yield !== undefined && m.yieldRanges.length > 0) {
    const yr = pickYieldRangeForCountry(p.method, p.country);
    if (yr && (p.yield < yr.min || p.yield > yr.max)) {
      probs.push({ code: 'YIELD_IMPOSSIBLE', detail: `yield ${p.yield} outside ${yr.min}–${yr.max}${yr.biome ? ` (${yr.biome})` : ''}` });
    }
  }

  // 7. Volume must equal area × yield for /ha/yr methods
  if (p.area && p.yield && p.yieldUnit?.includes('/ha/yr')) {
    const expected = Math.round(p.area * p.yield);
    if (Math.abs(p.volume - expected) > 1) {
      probs.push({ code: 'VOLUME_INCONSISTENT', detail: `${p.area} × ${p.yield} = ${expected} but volume = ${p.volume}` });
    }
  }

  return probs;
}

// ---- Report ----
// Optional: audit only rounds from a given day onward, e.g. `tsx scripts/audit-projects.ts 19`
const fromDay = Number(process.argv[2]) || 1;

let bugs = 0;
let looksFake = 0;
let muddied = 0;

console.log('═'.repeat(78));
console.log(`CARBON ROULETTE — round-by-round consistency audit${fromDay > 1 ? ` (rounds ≥ ${fromDay})` : ''}`);
console.log('═'.repeat(78));

for (const p of projects.sort((a, b) => a.day - b.day)) {
  if (p.day < fromDay) continue;
  const probs = hardProblems(p);
  const geo = nameGeoProblem(p);
  const hasFraud = p.violations.some(v => v.type === 'FRAUD_PATTERN');
  const tag = `day ${String(p.day).padStart(2)} · ${p.methodName} · ${p.country} · ${p.standard}`;

  if (p.isLegit) {
    if (probs.length > 0) {
      bugs++;
      console.log(`\n❌ BUG  ${tag}`);
      console.log(`        labelled LEGIT but has real violation(s) → correct answer should be SCAM:`);
      probs.forEach(x => console.log(`          • [${x.code}] ${x.detail}`));
      if (geo) console.log(`          • [${geo.code}] ${geo.detail}`);
    } else if (geo) {
      // Rule-valid, but the title geography contradicts the country → a player reads it
      // as fabricated and flags SCAM, so a legit round "fails" in their eyes.
      looksFake++;
      console.log(`\n🟠 fake ${tag}`);
      console.log(`        rule-valid LEGIT, but the title geography contradicts the country → players distrust it:`);
      console.log(`          • [${geo.code}] ${geo.detail}`);
    } else {
      console.log(`✅ ok   ${tag}  (clean legit)`);
    }
  } else {
    const justified = probs.length > 0 || hasFraud;
    if (!justified) {
      bugs++;
      console.log(`\n❌ BUG  ${tag}`);
      console.log(`        labelled SCAM but no detectable red flag → verdict unjustified`);
    } else {
      // Which declared violation types map to a real hard problem?
      const declaredCodes = new Set(p.violations.map(v => v.type));
      const extra = probs.filter(x => !declaredCodes.has(x.code));
      // A title/country mismatch on a SCAM is harmless — it only nudges players toward
      // the (correct) scam call — so it's a note, not a finding.
      const geoNote = geo ? '  · note: title/country mismatch (harmless on a scam)' : '';
      if (extra.length > 0) {
        muddied++;
        console.log(`\n⚠️  warn ${tag}`);
        console.log(`        SCAM verdict OK (flag: ${[...declaredCodes].join(', ')}), but extra UNFLAGGED contradiction(s):`);
        extra.forEach(x => console.log(`          • [${x.code}] ${x.detail}`));
      } else {
        console.log(`✅ ok   ${tag}  (scam: ${[...declaredCodes].join(', ')})${geoNote}`);
      }
    }
  }
}

console.log('\n' + '═'.repeat(78));
console.log(`RESULT: ${bugs} verdict bug(s), ${looksFake} looks-fake legit(s), ${muddied} muddied scam(s)`);
console.log('═'.repeat(78));
process.exit(bugs + looksFake > 0 ? 1 : 0);
