/**
 * Project Generator — run with `npm run generate`
 * Produces src/projects/projects.json with 30 pre-validated projects.
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  METHODS, SCOPE_MATRIX, STANDARD_NAMES, AUDITOR_NAMES, PROJECT_NAME_PARTS,
  WRONG_METHODOLOGY_MAP, IMPOSSIBLE_COUNTRIES, BIOME_YIELDS, COUNTRY_BIOME,
  getValidStandards, getInvalidStandards,
  type MethodId, type StandardId, type ViolationType, type YieldRange,
} from './datasets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Types ----

export interface Violation {
  type: ViolationType;
  field: string;
  explanation: string;
}

export interface Project {
  id: number;
  day: number;
  name: string;
  country: string;
  method: MethodId;
  methodName: string;
  standard: string;
  standardId: StandardId;
  methodologyId: string;
  volume: number;
  price: number;
  yield?: number;
  yieldUnit?: string;
  area?: number;
  auditor: string;
  description: string;
  isLegit: boolean;
  violations: Violation[];
  verdictExplanation: string;
  difficulty: 1 | 2 | 3;
}

// ---- Helpers ----

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number, decimals = 2): number {
  const val = min + Math.random() * (max - min);
  return Number(val.toFixed(decimals));
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function generateName(method: MethodId): string {
  const prefix = pick(PROJECT_NAME_PARTS.prefixes);
  const methodWord = pick(PROJECT_NAME_PARTS.methodWords[method]);
  const suffix = pick(PROJECT_NAME_PARTS.suffixes);
  return `${prefix} ${methodWord} ${suffix}`;
}

// Get a valid methodology ID string for display
function getMethodologyDisplay(standard: StandardId, method: MethodId): string {
  const ids = METHODS[method].methodologyIds[standard];
  if (ids && ids.length > 0) return pick(ids);
  // Fallback: use the first available standard's ID
  for (const s of getValidStandards(method)) {
    const fallback = METHODS[method].methodologyIds[s];
    if (fallback && fallback.length > 0) return pick(fallback);
  }
  return 'N/A';
}

// Pick the correct yield range based on country biome (for methods with multiple biome-specific ranges)
function pickYieldRangeForCountry(method: MethodId, country: string): YieldRange {
  const m = METHODS[method];
  if (m.yieldRanges.length <= 1) return m.yieldRanges[0];

  // Methods with biome-specific ranges: ARR, Agroforestry
  const countryBiome = COUNTRY_BIOME[country];
  if (countryBiome) {
    const matching = m.yieldRanges.find(yr => yr.biome === countryBiome);
    if (matching) return matching;
  }
  // Fallback: first range
  return m.yieldRanges[0];
}

// ---- Legit project generation ----

function generateLegitProject(id: number, day: number, method: MethodId): Project {
  const m = METHODS[method];
  const validStandards = getValidStandards(method);
  const standardId = pick(validStandards);
  const country = pick(m.countries);
  const price = randBetween(m.priceRange.min, m.priceRange.max);
  const methodologyId = getMethodologyDisplay(standardId, method);
  const auditor = pick(AUDITOR_NAMES);

  // Yield and volume
  let yieldVal: number | undefined;
  let yieldUnit: string | undefined;
  let area: number | undefined;
  let volume: number;
  let usedYieldRange: YieldRange | undefined;

  if (m.yieldRanges.length > 0) {
    const yieldRange = pickYieldRangeForCountry(method, country);
    usedYieldRange = yieldRange;
    yieldVal = randBetween(yieldRange.min, yieldRange.max, 1);
    yieldUnit = yieldRange.unit;

    if (yieldUnit.includes('/ha/yr')) {
      area = randInt(500, 20000);
      volume = Math.round(area * yieldVal);
    } else if (yieldUnit.includes('/stove/yr')) {
      const stoves = randInt(5000, 80000);
      volume = Math.round(stoves * yieldVal);
      area = undefined;
    } else if (yieldUnit.includes('/tonne biochar')) {
      // Biochar: generate production tonnage, then multiply by sequestration rate
      const tonnesBiochar = randInt(500, 5000);
      volume = Math.round(tonnesBiochar * yieldVal);
    } else {
      // Facility-based (DAC, landfill, RE) — yieldRange IS the volume range
      volume = randInt(yieldRange.min, yieldRange.max);
      yieldVal = undefined;
      yieldUnit = undefined;
      usedYieldRange = undefined;
    }
  } else {
    volume = randInt(10000, 200000);
  }

  const description = generateLegitDescription(method, country, volume, area, yieldVal);
  const verdictExplanation = generateLegitVerdict(method, standardId, methodologyId, price, yieldVal, usedYieldRange);

  return {
    id, day, name: generateName(method),
    country, method, methodName: m.name,
    standard: STANDARD_NAMES[standardId], standardId,
    methodologyId, volume, price,
    yield: yieldVal, yieldUnit, area, auditor,
    description, isLegit: true, violations: [],
    verdictExplanation, difficulty: 1,
  };
}

function generateLegitDescription(method: MethodId, country: string, volume: number, area?: number, yieldVal?: number): string {
  const areaStr = area ? area.toLocaleString() : '';
  const volStr = volume.toLocaleString();
  const templates: Record<MethodId, string[]> = {
    ARR: [
      `Large-scale native species planting on degraded land in ${country}. ${areaStr ? `${areaStr} hectares` : 'Multiple sites'} targeted for reforestation over a 30-year crediting period. Satellite monitoring and ground-truth plots verified annually.`,
      `Reforestation of former agricultural land in ${country} using mixed indigenous species. ${areaStr ? `${areaStr} hectares under management.` : ''} Planting densities follow regional forestry guidelines. Permanent sample plots established for biomass measurement.`,
      `Native forest restoration across degraded watersheds in ${country}. ${areaStr ? `Project spans ${areaStr} hectares.` : ''} Species mix designed for long-term carbon storage and biodiversity. Fire management plan in place. Annual remote sensing verification.`,
    ],
    REDD: [
      `Protection of ${areaStr ? `${areaStr} hectares of` : ''} primary tropical forest from planned agricultural conversion in ${country}. Deforestation baseline established using 10-year historical reference data. Community benefit-sharing agreements in place.`,
      `Conservation of intact tropical forest in ${country} threatened by logging concessions. ${areaStr ? `${areaStr} hectares` : 'Large area'} under protection. Baseline deforestation modeled from regional land-use change data. Indigenous community partnerships established.`,
      `Avoided deforestation project protecting high-biodiversity forest in ${country}. ${areaStr ? `Covers ${areaStr} hectares.` : ''} Threat assessment based on proximity to active frontier clearing. Patrol and monitoring teams deployed. Buffer pool contributions maintained.`,
    ],
    BLUE_CARBON: [
      `Restoration of degraded mangrove ecosystems along the coast of ${country}. Hydrology restored through channel clearing. Nursery-raised seedlings planted at density appropriate for local tidal regime.`,
      `Coastal wetland rehabilitation in ${country} targeting previously cleared mangrove areas. Hydrological connectivity restored to support natural regeneration. Community nurseries provide locally adapted propagules. Sediment carbon measured at baseline.`,
      `Mangrove replanting program along eroded shoreline in ${country}. ${areaStr ? `${areaStr} hectares` : 'Extensive coastal zone'} under restoration. Species selected for local salinity and tidal conditions. Survival monitoring conducted quarterly.`,
    ],
    COOKSTOVES: [
      `Distribution of efficient biomass cookstoves to rural households in ${country}. Field usage surveys conducted quarterly. Baseline fuel consumption from regional assessment. fNRB factor documented.`,
      `Deployment of improved cooking technology to communities in ${country}. Stoves tested to ISO 19867 standard. Usage monitoring via kitchen performance tests and spot checks. Fuel savings validated against regional woodfuel assessment.`,
      `Clean cookstove program in ${country} replacing traditional three-stone fires. Thermal efficiency independently tested. Adoption tracked through household surveys and sales records. Non-renewable biomass fraction based on national forest inventory data.`,
    ],
    BIOCHAR: [
      `Industrial-scale pyrolysis of forestry residues producing stable biochar for agricultural soil amendment. Carbon content verified via lab analysis per batch. Feedstock sourced from certified sustainable forestry operations in ${country}.`,
      `Biochar production facility in ${country} converting crop waste into stable carbon through controlled pyrolysis. Each batch tested for H:C ratio and carbon stability. Product applied to local agricultural soils under monitored conditions.`,
      `Thermochemical conversion of sustainably sourced biomass into biochar at a dedicated facility in ${country}. Permanence validated through accelerated aging tests. Full lifecycle emissions accounting including transport and application.`,
    ],
    DAC: [
      `Solid sorbent direct air capture facility powered by geothermal energy in ${country}. Captured CO₂ injected into basalt formations for permanent mineralization. Third-party MRV conducted annually.`,
      `Direct air capture plant in ${country} using modular contactor arrays. Low-carbon energy supply from dedicated renewable source. CO₂ permanently stored via geological injection. Continuous capture rate monitoring with independent annual verification.`,
      `Atmospheric CO₂ removal facility in ${country} employing chemical sorbent technology. Captured carbon compressed and transported to deep geological storage. Energy consumption and net removal independently audited each year.`,
    ],
    SOIL_CARBON: [
      `Transition from conventional tillage to no-till regenerative practices across ${areaStr ? `${areaStr} hectares of` : ''} cropland in ${country}. Soil organic carbon measured at 0-30cm depth using stratified random sampling.`,
      `Regenerative agriculture program in ${country} implementing cover cropping and reduced tillage. ${areaStr ? `${areaStr} hectares enrolled.` : ''} Soil samples collected annually at fixed monitoring points. Bulk density and organic carbon measured to 30cm depth.`,
      `Soil carbon enhancement through conservation agriculture practices in ${country}. ${areaStr ? `Project covers ${areaStr} hectares.` : ''} Baseline established with stratified soil sampling. Practices include no-till, crop rotation, and organic amendments.`,
    ],
    AGROFORESTRY: [
      `Integration of shade trees into existing agricultural systems in ${country}. ${areaStr ? `${areaStr} hectares` : 'Multiple farms'} enrolled. Tree species selected for compatibility with local crops and climate.`,
      `Agroforestry expansion across smallholder farms in ${country}. ${areaStr ? `${areaStr} hectares under management.` : ''} Trees planted along field boundaries and within crop plots. Species chosen for timber, fruit, and carbon value. Biomass measured using allometric equations.`,
      `Silvopastoral system establishment in ${country} combining trees with livestock grazing. ${areaStr ? `${areaStr} hectares enrolled.` : ''} Tree density optimized for shade provision and carbon accumulation. Annual biomass inventory using plot-level measurements.`,
    ],
    LANDFILL_GAS: [
      `Capture and flaring of methane from an active municipal solid waste landfill in ${country}. Gas collection system covers the main waste body. Continuous flow monitoring with quarterly third-party verification.`,
      `Landfill gas recovery system installed at a major waste disposal site in ${country}. Methane captured via horizontal and vertical well network. Gas flow and composition monitored continuously. Destruction efficiency verified by independent auditor.`,
      `Methane destruction project at a municipal landfill in ${country}. Enclosed flare system with automated ignition. Collection efficiency monitored across the waste mass. Quarterly emissions reports submitted to the registry.`,
    ],
    RENEWABLE_ENERGY: [
      `Grid-connected renewable energy facility displacing fossil fuel generation in ${country}. Emission reductions calculated using combined margin grid emission factor. Metered output verified monthly.`,
      `Utility-scale clean energy generation in ${country} feeding directly into the national grid. Displaces thermal generation from coal and gas plants. Net electricity exported measured by calibrated revenue meters. Grid emission factor from national authority.`,
      `Renewable power plant in ${country} reducing reliance on fossil-fuel electricity. Project connected to the national grid with dedicated metering. Baseline emissions calculated from published grid emission factors. Annual generation independently verified.`,
    ],
  };
  const options = templates[method];
  // Use day-based index to guarantee variety across projects of same method
  if (!descriptionCounters[method]) descriptionCounters[method] = 0;
  const idx = descriptionCounters[method] % options.length;
  descriptionCounters[method]++;
  return options[idx];
}

// Track which template index to use next per method (ensures no duplicates)
const descriptionCounters: Partial<Record<MethodId, number>> = {};

function generateLegitVerdict(method: MethodId, standard: StandardId, methodologyId: string, price: number, yieldVal?: number, usedYieldRange?: YieldRange): string {
  const m = METHODS[method];
  const compatibility = SCOPE_MATRIX[method][standard];
  const parts: string[] = [];

  if (compatibility === 'LIMITED') {
    parts.push(`${STANDARD_NAMES[standard]} has limited scope for ${m.name.toLowerCase()} projects, but does accept them under specific conditions.`);
  } else {
    parts.push(`${STANDARD_NAMES[standard]} is a valid certifier for ${m.name.toLowerCase()} projects.`);
  }

  if (methodologyId !== 'N/A') {
    parts.push(`${methodologyId} is the correct methodology for this project type.`);
  }
  parts.push(`$${price}/tonne falls within the documented range ($${m.priceRange.min}–${m.priceRange.max}).`);
  if (yieldVal && usedYieldRange) {
    const biomeLabel = usedYieldRange.biome ? ` (${usedYieldRange.biome})` : '';
    parts.push(`yield of ${yieldVal} ${usedYieldRange.unit} is within the documented range${biomeLabel} (${usedYieldRange.min}–${usedYieldRange.max}).`);
  }
  return parts.join(' ');
}

// ---- Scam project generation ----

function generateScamProject(id: number, day: number, method: MethodId, difficulty: 1 | 2 | 3): Project {
  // Start with a legit base, then inject violations
  const base = generateLegitProject(id, day, method);
  base.isLegit = false;
  base.difficulty = difficulty;
  base.violations = [];

  switch (difficulty) {
    case 1:
      injectEasyViolation(base);
      break;
    case 2:
      injectMediumViolation(base);
      break;
    case 3:
      injectHardViolation(base);
      break;
  }

  base.verdictExplanation = buildScamVerdict(base);
  return base;
}

function injectEasyViolation(p: Project): void {
  const roll = Math.random();

  if (roll < 0.33 && IMPOSSIBLE_COUNTRIES[p.method].length > 0) {
    // Wrong country
    const wrongCountry = pick(IMPOSSIBLE_COUNTRIES[p.method]);
    const originalCountry = p.country;
    p.violations.push({
      type: 'WRONG_COUNTRY',
      field: 'country',
      explanation: `${p.methodName} projects don't exist in ${wrongCountry}. this biome/method requires ${METHODS[p.method].countries.slice(0, 3).join(', ')} or similar tropical/subtropical regions.`,
    });
    p.country = wrongCountry;
    // Replace the actual country used in the description, not the first from the list
    p.description = p.description.replace(new RegExp(originalCountry, 'g'), wrongCountry);
  } else if (roll < 0.66) {
    // Price wildly out of range
    const m = METHODS[p.method];
    const wrongPrice = m.priceRange.max < 50
      ? randBetween(m.priceRange.max * 3, m.priceRange.max * 5)
      : randBetween(m.priceRange.min * 0.02, m.priceRange.min * 0.1);
    p.violations.push({
      type: 'PRICE_OUT_OF_RANGE',
      field: 'price',
      explanation: `$${wrongPrice}/tonne is way outside the documented range for ${p.methodName.toLowerCase()} ($${m.priceRange.min}–${m.priceRange.max}/tonne).`,
    });
    p.price = wrongPrice;
  } else {
    // Wrong standard
    const invalidStandards = getInvalidStandards(p.method);
    if (invalidStandards.length > 0) {
      const wrongStd = pick(invalidStandards);
      p.violations.push({
        type: 'WRONG_STANDARD',
        field: 'standard',
        explanation: `${STANDARD_NAMES[wrongStd]} does not certify ${p.methodName.toLowerCase()} projects. the scope matrix says NO.`,
      });
      p.standardId = wrongStd;
      p.standard = STANDARD_NAMES[wrongStd];
      // Change methodology ID for visual consistency, but don't flag it
      // as a separate violation — easy scams should have a single obvious red flag
      const wrongIds = WRONG_METHODOLOGY_MAP[p.method];
      if (wrongIds.length > 0) {
        const w = pick(wrongIds);
        p.methodologyId = w.id;
      }
    } else {
      // Fallback to price violation
      injectEasyViolation(p);
    }
  }
}

function injectMediumViolation(p: Project): void {
  const roll = Math.random();

  if (roll < 0.4) {
    // Wrong methodology ID
    const wrongIds = WRONG_METHODOLOGY_MAP[p.method];
    if (wrongIds.length > 0) {
      const w = pick(wrongIds);
      p.violations.push({
        type: 'WRONG_METHODOLOGY_ID',
        field: 'methodologyId',
        explanation: `${w.id} is ${METHODS[w.realMethod].name}'s methodology, not ${p.methodName}'s. the correct methodology would be ${getMethodologyDisplay(p.standardId, p.method)}.`,
      });
      p.methodologyId = w.id;
    }
  } else if (roll < 0.7 && p.yield !== undefined) {
    // Yield impossible for biome
    const m = METHODS[p.method];
    if (m.yieldRanges.length > 0) {
      const yr = pickYieldRangeForCountry(p.method, p.country);
      const impossibleYield = randBetween(yr.max * 1.5, yr.max * 2.5, 1);
      const biomeLabel = yr.biome ? ` (${yr.biome})` : '';
      p.violations.push({
        type: 'YIELD_IMPOSSIBLE',
        field: 'yield',
        explanation: `${impossibleYield} ${yr.unit} is above the documented maximum of ${yr.max} ${yr.unit} for this method/biome${biomeLabel}.`,
      });
      p.yield = impossibleYield;
      // Recalculate volume to match the inflated yield
      if (p.area) {
        p.volume = Math.round(p.area * impossibleYield);
      }
    }
  } else if (p.area && p.yield) {
    // Volume inconsistent with area x yield
    const correctVolume = Math.round(p.area * p.yield);
    const inflatedVolume = Math.round(correctVolume * randBetween(2.5, 4.0));
    p.violations.push({
      type: 'VOLUME_INCONSISTENT',
      field: 'volume',
      explanation: `${p.area.toLocaleString()} ha × ${p.yield} ${p.yieldUnit} = ~${correctVolume.toLocaleString()} tCO₂e/yr max. the claimed ${inflatedVolume.toLocaleString()} tCO₂e/yr is ${(inflatedVolume / correctVolume).toFixed(1)}× too high.`,
    });
    p.volume = inflatedVolume;
  } else {
    // Fallback to wrong methodology
    const wrongIds = WRONG_METHODOLOGY_MAP[p.method];
    if (wrongIds.length > 0) {
      const w = pick(wrongIds);
      p.violations.push({
        type: 'WRONG_METHODOLOGY_ID',
        field: 'methodologyId',
        explanation: `${w.id} is ${METHODS[w.realMethod].name}'s methodology, not ${p.methodName}'s.`,
      });
      p.methodologyId = w.id;
    }
  }
}

function injectHardViolation(p: Project): void {
  const roll = Math.random();

  if (roll < 0.35) {
    // Subtle wrong methodology + fraud pattern in description
    const wrongIds = WRONG_METHODOLOGY_MAP[p.method];
    if (wrongIds.length > 0) {
      const w = pick(wrongIds);
      p.violations.push({
        type: 'WRONG_METHODOLOGY_ID',
        field: 'methodologyId',
        explanation: `${w.id} is ${METHODS[w.realMethod].name}'s methodology framework, not ${p.methodName}'s.`,
      });
      p.methodologyId = w.id;
    }
  } else if (roll < 0.65) {
    // Yield slightly above max
    const m = METHODS[p.method];
    if (m.yieldRanges.length > 0 && p.yield !== undefined) {
      const yr = pickYieldRangeForCountry(p.method, p.country);
      const slightlyOver = randBetween(yr.max * 1.1, yr.max * 1.3, 1);
      const biomeLabel = yr.biome ? ` (${yr.biome})` : '';
      p.violations.push({
        type: 'YIELD_IMPOSSIBLE',
        field: 'yield',
        explanation: `${slightlyOver} ${yr.unit} exceeds the documented maximum of ${yr.max} for this biome${biomeLabel}. subtle, but the math doesn't check out.`,
      });
      p.yield = slightlyOver;
      if (p.area) p.volume = Math.round(p.area * slightlyOver);
    }
  }

  // Always add a fraud pattern for hard scams
  const fraudDescriptions = generateFraudDescription(p);
  p.description = fraudDescriptions.description;
  p.violations.push({
    type: 'FRAUD_PATTERN',
    field: 'description',
    explanation: fraudDescriptions.explanation,
  });
}

function generateFraudDescription(p: Project): { description: string; explanation: string } {
  const areaStr = p.area ? p.area.toLocaleString() : '8,000';
  const patterns: Record<MethodId, { description: string; explanation: string }[]> = {
    REDD: [
      {
        description: `Avoided deforestation in primary rainforest in ${p.country}. Projected deforestation rate of 8% per year based on regional economic models. Buffer pool of 5%. Crediting period: 40 years with no interim baseline update scheduled.`,
        explanation: 'red flags: 8% annual deforestation rate is far above typical tropical deforestation (1-3%/yr). a 5% buffer pool is minimal for a 40-year period with fire/political risk. no interim baseline updates means the inflated baseline goes unchallenged.',
      },
      {
        description: `Protection of ${areaStr} ha of forest in ${p.country} from planned conversion to oil palm. Credits issued based on projected avoided emissions using 2015 baseline. No leakage assessment included as project is "sufficiently isolated."`,
        explanation: 'red flags: credits based on "projected" rather than verified emissions, using a 2015 baseline without updates. claiming no leakage because the project is "sufficiently isolated" contradicts documented patterns where deforestation simply shifts outside the boundary.',
      },
      {
        description: `Community forest conservation in ${p.country} claiming to protect ${areaStr} ha. Emission reduction estimates based on 2012 satellite imagery without ground-truth validation. Project boundary overlaps with a pre-existing national park.`,
        explanation: 'red flags: relying on 2012 satellite imagery without ground-truth verification is outdated MRV. boundary overlap with an existing protected area raises serious additionality concerns — the forest was already being protected.',
      },
    ],
    ARR: [
      {
        description: `Planting of fast-growing eucalyptus monoculture on degraded pasture. Credits issued based on projected growth models from year 1. No ground-truth measurements until year 5. Sequestration rates based on optimal nursery conditions.`,
        explanation: 'red flags: monoculture eucalyptus has lower biodiversity value. credits based on "projected" growth from year 1 without measurement is a documented over-crediting pattern. nursery-condition growth rates don\'t translate to field performance.',
      },
    ],
    BLUE_CARBON: [
      {
        description: `Mangrove planting along eroded coastline. Sequestration estimated from published averages for Southeast Asian mangroves. No site-specific hydrology assessment. Survival rate assumed at 95%.`,
        explanation: 'red flags: using generic "published averages" instead of site-specific measurements. no hydrology assessment for a tidal system is a major gap. 95% survival rate is unrealistically high for mangrove restoration (typical: 50-70%).',
      },
    ],
    COOKSTOVES: [
      {
        description: `Distribution of 25,000 efficient biomass stoves. Emissions reductions calculated using default fNRB of 0.95 and assumed 100% daily usage. Monitoring via annual telephone survey of 200 households.`,
        explanation: 'red flags: fNRB of 0.95 is at the extreme high end. assuming 100% daily usage ignores documented "stove stacking" where households continue using traditional stoves. annual phone surveys of <1% of users is insufficient monitoring.',
      },
    ],
    BIOCHAR: [
      {
        description: `Biochar produced from mixed municipal waste feedstock. Carbon stability estimated at 90% over 100 years based on accelerated aging tests. No third-party feedstock sourcing verification.`,
        explanation: 'red flags: mixed municipal waste feedstock raises contamination concerns and variable carbon content. 90% stability from accelerated tests without field validation is optimistic. no feedstock verification means carbon content claims are unsubstantiated.',
      },
    ],
    DAC: [
      {
        description: `Novel liquid solvent DAC system at pilot scale. Projected capture capacity of ${p.volume.toLocaleString()} tCO₂/yr based on lab-scale extrapolation. Energy sourced from local grid (coal-dominant). Permanent storage via enhanced oil recovery.`,
        explanation: `red flags: lab-scale extrapolation to ${p.volume.toLocaleString()} t/yr is unproven. coal-dominant grid energy undermines the net removal. enhanced oil recovery as "permanent storage" is controversial — it enables more fossil fuel extraction.`,
      },
    ],
    SOIL_CARBON: [
      {
        description: `No-till conversion across ${areaStr} ha. Soil carbon gains projected at 3.5 tCO₂/ha/yr constant over 25 years. Measurement every 5 years. No provisions for monitoring reversals from drought or land-use change.`,
        explanation: 'red flags: 3.5 tCO₂/ha/yr is well above the documented range (0.73-1.83). assuming constant gains over 25 years ignores documented saturation curves. measurement every 5 years is infrequent. no reversal monitoring is a documented integrity failure.',
      },
    ],
    AGROFORESTRY: [
      {
        description: `Shade tree integration into coffee farms across ${areaStr} ha. Carbon benefits estimated from similar projects in another continent. No species-specific allometric equations used. Baseline assumes zero existing tree cover.`,
        explanation: 'red flags: using data "from another continent" instead of local measurements. no species-specific allometrics means carbon estimates are unreliable. assuming zero baseline tree cover inflates the project\'s additionality.',
      },
    ],
    LANDFILL_GAS: [
      {
        description: `Methane capture from a landfill that was already under regulatory mandate to install gas collection. Carbon revenue described as "critical for project viability" despite the regulatory requirement.`,
        explanation: 'red flags: if gas collection is already mandated by regulation, the project may not be additional — it would have happened anyway. claiming carbon revenue is "critical" when there\'s a regulatory mandate is a documented additionality failure.',
      },
    ],
    RENEWABLE_ENERGY: [
      {
        description: `Grid-connected 50 MW solar farm in ${p.country} with established feed-in tariff and 15% IRR without carbon revenue. Baseline assumes continued coal-dominant grid for 21-year crediting period despite national decarbonization targets.`,
        explanation: 'red flags: 15% IRR without carbon revenue suggests the project is economically viable anyway (non-additional). assuming coal-dominant grid for 21 years while the country has decarbonization targets inflates baseline emissions.',
      },
      {
        description: `Wind farm in ${p.country} claiming ${p.volume.toLocaleString()} tCO₂e/yr in avoided emissions. Project registered 3 years after construction began and grid connection was already secured. Emission factor uses outdated 2016 national grid data despite significant renewable capacity additions since.`,
        explanation: 'red flags: registering 3 years after construction suggests the project was already committed — a classic additionality failure. using outdated grid emission factors (2016) when the grid has since added renewables inflates the baseline and overstates emission reductions.',
      },
    ],
  };

  const options = patterns[p.method] ?? patterns.REDD;
  // Use counter to avoid duplicate fraud descriptions for same method
  if (!fraudDescCounters[p.method]) fraudDescCounters[p.method] = 0;
  const idx = fraudDescCounters[p.method]! % options.length;
  fraudDescCounters[p.method]!++;
  return options[idx];
}

const fraudDescCounters: Partial<Record<MethodId, number>> = {};

function buildScamVerdict(p: Project): string {
  const parts = [`red flags you should've caught:`];
  for (const v of p.violations) {
    parts.push(`→ ${v.explanation}`);
  }
  return parts.join('\n');
}

// ============================================================
// MAIN: Generate 30 projects
// ============================================================

const ALL_METHODS: MethodId[] = [
  'ARR', 'REDD', 'BLUE_CARBON', 'COOKSTOVES', 'BIOCHAR',
  'DAC', 'SOIL_CARBON', 'AGROFORESTRY', 'LANDFILL_GAS', 'RENEWABLE_ENERGY',
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle entries ensuring no 4+ consecutive legit or 3+ consecutive scam.
 * Retries up to 100 times, then falls back to best attempt.
 */
function antiStreakShuffle(entries: { method: MethodId; isLegit: boolean }[]): { method: MethodId; isLegit: boolean }[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = shuffle(entries);
    if (hasAcceptableStreaks(candidate)) return candidate;
  }
  // Fallback: manually interleave to guarantee no streaks
  const scams = entries.filter(e => !e.isLegit);
  const legits = entries.filter(e => e.isLegit);
  const result: typeof entries = [];
  let si = 0, li = 0;
  // Place scams at positions that break up legit runs: 2, 5, 7, 9 (for 4 scams in 10)
  const scamPositions = new Set([2, 5, 7, 9]);
  for (let i = 0; i < entries.length; i++) {
    if (scamPositions.has(i) && si < scams.length) {
      result.push(scams[si++]);
    } else if (li < legits.length) {
      result.push(legits[li++]);
    } else {
      result.push(scams[si++]);
    }
  }
  return result;
}

function hasAcceptableStreaks(entries: { isLegit: boolean }[]): boolean {
  let streak = 1;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].isLegit === entries[i - 1].isLegit) {
      streak++;
      if (entries[i].isLegit && streak >= 4) return false;  // 4+ legit
      if (!entries[i].isLegit && streak >= 3) return false;  // 3+ scam
    } else {
      streak = 1;
    }
  }
  return true;
}

function generate(): Project[] {
  // Plan: 30 projects, 18 legit, 12 scam (4 per difficulty)
  // Constraint: every method gets exactly 3 projects, at least 1 legit and 1 scam

  // Step 1: Assign legit/scam per method
  // Each method gets 3 projects. We need 12 scam total across 10 methods.
  // Give each method exactly 1 scam → 10 scam. Need 2 more.
  // Pick 2 random methods to get a 2nd scam (they'll have 1 legit, 2 scam).
  // Remaining 8 methods have 2 legit, 1 scam.
  const methodAssignments: { method: MethodId; isLegit: boolean }[] = [];

  // Each method: 1 scam guaranteed
  const scamMethods = shuffle(ALL_METHODS);
  for (const m of ALL_METHODS) {
    methodAssignments.push({ method: m, isLegit: false }); // 1 scam each
    methodAssignments.push({ method: m, isLegit: true });  // 1 legit each
  }
  // 10 remaining slots (30 - 20 = 10), need 2 more scam + 8 more legit
  const extraScamMethods = shuffle(ALL_METHODS).slice(0, 2);
  for (const m of extraScamMethods) {
    methodAssignments.push({ method: m, isLegit: false });
  }
  const extraLegitMethods = shuffle(ALL_METHODS.filter(m => !extraScamMethods.includes(m)));
  for (const m of extraLegitMethods) {
    methodAssignments.push({ method: m, isLegit: true });
  }

  // Step 2: Separate into scam and legit pools
  const scamPool = shuffle(methodAssignments.filter(a => !a.isLegit));  // 12
  const legitPool = shuffle(methodAssignments.filter(a => a.isLegit));  // 18

  // Step 3: Distribute across 3 blocks of 10 (4 scam + 6 legit per block)
  // Retry entire assembly if cross-block boundaries create bad streaks
  for (let globalAttempt = 0; globalAttempt < 50; globalAttempt++) {
    const scamCopy = [...scamPool];
    const legitCopy = [...legitPool];
    const allEntries: { method: MethodId; isLegit: boolean; difficulty: 1 | 2 | 3 }[] = [];

    for (let block = 0; block < 3; block++) {
      const difficulty = (block + 1) as 1 | 2 | 3;
      const blockScam = scamCopy.splice(0, 4);
      const blockLegit = legitCopy.splice(0, 6);
      const blockEntries = antiStreakShuffle([...blockScam, ...blockLegit]);
      for (const e of blockEntries) {
        allEntries.push({ ...e, difficulty });
      }
    }

    // Check full 30-entry sequence for cross-block streaks
    if (hasAcceptableStreaks(allEntries)) {
      const projects: Project[] = [];
      let nextId = 1;
      for (let i = 0; i < 30; i++) {
        const day = i + 1;
        const { method, isLegit, difficulty } = allEntries[i];
        const project = isLegit
          ? generateLegitProject(nextId, day, method)
          : generateScamProject(nextId, day, method, difficulty);
        projects.push(project);
        nextId++;
      }
      return projects;
    }
  }

  // Fallback: should never reach here, but generate without streak check
  console.warn('WARNING: could not find streak-free arrangement after 50 attempts');
  const projects: Project[] = [];
  let nextId = 1;
  for (let block = 0; block < 3; block++) {
    const difficulty = (block + 1) as 1 | 2 | 3;
    const blockScam = scamPool.splice(0, 4);
    const blockLegit = legitPool.splice(0, 6);
    const blockEntries = antiStreakShuffle([...blockScam, ...blockLegit]);
    for (let i = 0; i < 10; i++) {
      const day = block * 10 + i + 1;
      const { method, isLegit } = blockEntries[i];
      const project = isLegit
        ? generateLegitProject(nextId, day, method)
        : generateScamProject(nextId, day, method, difficulty);
      projects.push(project);
      nextId++;
    }
  }
  return projects;
}

// ---- Run ----

const projects = generate();

// Validate
const legitCount = projects.filter(p => p.isLegit).length;
const scamCount = projects.filter(p => !p.isLegit).length;
console.log(`generated ${projects.length} projects: ${legitCount} legit, ${scamCount} scam`);

// Check legit projects have no violations
for (const p of projects.filter(p => p.isLegit)) {
  if (p.violations.length > 0) {
    console.error(`BUG: legit project ${p.id} (day ${p.day}) has violations!`);
    process.exit(1);
  }
}

// Check scam projects have at least one violation
for (const p of projects.filter(p => !p.isLegit)) {
  if (p.violations.length === 0) {
    console.error(`BUG: scam project ${p.id} (day ${p.day}) has no violations!`);
    process.exit(1);
  }
}

// Difficulty distribution
for (const d of [1, 2, 3] as const) {
  const scams = projects.filter(p => !p.isLegit && p.difficulty === d);
  console.log(`  difficulty ${d}: ${scams.length} scams`);
}

// Check every method has at least 1 legit AND 1 scam
for (const method of ALL_METHODS) {
  const methodProjects = projects.filter(p => p.method === method);
  const hasLegit = methodProjects.some(p => p.isLegit);
  const hasScam = methodProjects.some(p => !p.isLegit);
  if (!hasLegit) {
    console.error(`BUG: method ${method} has no legit project!`);
    process.exit(1);
  }
  if (!hasScam) {
    console.error(`BUG: method ${method} has no scam project!`);
    process.exit(1);
  }
  console.log(`  ${method}: ${methodProjects.filter(p => p.isLegit).length} legit, ${methodProjects.filter(p => !p.isLegit).length} scam`);
}

// Validate volumes are realistic
for (const p of projects) {
  if (p.volume < 100) {
    console.error(`BUG: project ${p.id} (day ${p.day}, ${p.methodName}) has unrealistic volume: ${p.volume}`);
    process.exit(1);
  }
  // For legit projects with area+yield, check math
  if (p.isLegit && p.area && p.yield && p.yieldUnit?.includes('/ha/yr')) {
    const expected = Math.round(p.area * p.yield);
    if (Math.abs(p.volume - expected) > 1) {
      console.error(`BUG: legit project ${p.id} (day ${p.day}) volume math wrong: ${p.area} × ${p.yield} = ${expected} but got ${p.volume}`);
      process.exit(1);
    }
  }
  // For legit projects, check price is within range
  if (p.isLegit) {
    const m = METHODS[p.method];
    if (p.price < m.priceRange.min || p.price > m.priceRange.max) {
      console.error(`BUG: legit project ${p.id} (day ${p.day}) price $${p.price} outside range $${m.priceRange.min}–${m.priceRange.max}`);
      process.exit(1);
    }
  }
  // For legit projects with yield, check it's within the correct biome's range
  if (p.isLegit && p.yield !== undefined && p.yieldUnit) {
    const m = METHODS[p.method];
    if (m.yieldRanges.length > 0) {
      const yr = pickYieldRangeForCountry(p.method, p.country);
      if (p.yield < yr.min || p.yield > yr.max) {
        console.error(`BUG: legit project ${p.id} (day ${p.day}, ${p.methodName}, ${p.country}) yield ${p.yield} outside biome range ${yr.min}–${yr.max} (${yr.biome ?? 'any'})`);
        process.exit(1);
      }
    }
  }
}
console.log(`  all volumes, prices, and calculations verified ✓`);

const outPath = resolve(__dirname, 'projects.json');
writeFileSync(outPath, JSON.stringify(projects, null, 2));
console.log(`written to ${outPath}`);
