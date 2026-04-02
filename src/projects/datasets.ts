// ============================================================
// DATASETS.TS — Source of truth for Carbon Roulette
// All values traced to the 4 markdown data files in data/
// ============================================================

export type MethodId =
  | 'ARR'
  | 'REDD'
  | 'BLUE_CARBON'
  | 'COOKSTOVES'
  | 'BIOCHAR'
  | 'DAC'
  | 'SOIL_CARBON'
  | 'AGROFORESTRY'
  | 'LANDFILL_GAS'
  | 'RENEWABLE_ENERGY';

export type StandardId =
  | 'VCS'
  | 'GOLD_STANDARD'
  | 'CDM'
  | 'PLAN_VIVO'
  | 'PURO_EARTH'
  | 'ACR'
  | 'CAR';

export type Compatibility = 'YES' | 'NO' | 'LIMITED' | 'EMERGING';

export interface PriceRange {
  min: number;
  max: number;
  source: string;
}

export interface YieldRange {
  min: number;
  max: number;
  unit: string;
  biome?: string;
}

export interface MethodData {
  id: MethodId;
  name: string;
  emoji: string;
  priceRange: PriceRange;
  yieldRanges: YieldRange[];
  methodologyIds: Partial<Record<StandardId, string[]>>;
  countries: string[];
}

// ============================================================
// SCOPE MATRIX — Standard/Method compatibility
// Source: Table 2 of voluntary_carbon_market_methods.md
//         Table 2 of method_specific_carbon_credit_data.md
// ============================================================

export const SCOPE_MATRIX: Record<MethodId, Record<StandardId, Compatibility>> = {
  ARR: {
    VCS: 'YES',           // VM0047
    GOLD_STANDARD: 'YES', // A/R methodologies
    CDM: 'YES',           // AR-ACM0003, AR-AMS0007
    PLAN_VIVO: 'YES',     // SHAMBA
    PURO_EARTH: 'NO',     // Focus on engineered removals
    ACR: 'YES',           // IFM/AFF forestry
    CAR: 'YES',           // US Forest protocols
  },
  REDD: {
    VCS: 'YES',           // VM0007, VM0048
    GOLD_STANDARD: 'NO',  // Explicitly does NOT issue REDD+
    CDM: 'NO',            // Not implemented at scale
    PLAN_VIVO: 'YES',     // Community forest conservation
    PURO_EARTH: 'NO',
    ACR: 'YES',           // REDD+ methodologies
    CAR: 'LIMITED',       // IFM-related, not dedicated REDD+
  },
  BLUE_CARBON: {
    VCS: 'YES',           // VM0033
    GOLD_STANDARD: 'LIMITED', // Emerging coastal wetlands
    CDM: 'NO',            // No dedicated mangrove methodology
    PLAN_VIVO: 'YES',     // Mangrove community restoration
    PURO_EARTH: 'NO',
    ACR: 'LIMITED',       // Under development
    CAR: 'NO',            // No tropical mangrove protocols
  },
  COOKSTOVES: {
    VCS: 'YES',           // VM0050, VMR0006
    GOLD_STANDARD: 'YES', // Methodology 408
    CDM: 'YES',           // AMS-II.G, AMS-I.E
    PLAN_VIVO: 'NO',      // Focus on land-based sequestration, not devices
    PURO_EARTH: 'NO',
    ACR: 'LIMITED',       // Some household device approaches
    CAR: 'LIMITED',       // Clean cooking exploration
  },
  BIOCHAR: {
    VCS: 'YES',           // VM0044
    GOLD_STANDARD: 'NO',  // No standalone biochar methodology
    CDM: 'NO',
    PLAN_VIVO: 'LIMITED', // Possible in agroforestry, not dedicated
    PURO_EARTH: 'YES',    // Flagship biochar methodology
    ACR: 'EMERGING',      // Investigating
    CAR: 'YES',           // U.S. and Canada Biochar protocol
  },
  DAC: {
    VCS: 'NO',            // No dedicated methodology as of early 2025
    GOLD_STANDARD: 'NO',
    CDM: 'NO',
    PLAN_VIVO: 'NO',
    PURO_EARTH: 'YES',    // GSC methodology
    ACR: 'NO',
    CAR: 'NO',
  },
  SOIL_CARBON: {
    VCS: 'YES',           // VM0042
    GOLD_STANDARD: 'YES', // Agriculture land use
    CDM: 'LIMITED',       // Some agricultural amendments
    PLAN_VIVO: 'YES',     // SHAMBA
    PURO_EARTH: 'NO',
    ACR: 'YES',           // Soil Enrichment Protocol
    CAR: 'EMERGING',      // In development
  },
  AGROFORESTRY: {
    VCS: 'YES',           // Within ARR/AFOLU
    GOLD_STANDARD: 'YES', // A/R and NCS scope
    CDM: 'YES',           // As A/R
    PLAN_VIVO: 'YES',     // Explicit eligibility
    PURO_EARTH: 'NO',
    ACR: 'YES',
    CAR: 'YES',
  },
  LANDFILL_GAS: {
    VCS: 'YES',           // VMR0016
    GOLD_STANDARD: 'LIMITED',
    CDM: 'YES',           // ACM0001, AMS-III.G
    PLAN_VIVO: 'NO',
    PURO_EARTH: 'NO',
    ACR: 'YES',           // LFG Destruction
    CAR: 'YES',           // U.S. Landfill Protocol
  },
  RENEWABLE_ENERGY: {
    VCS: 'YES',
    GOLD_STANDARD: 'YES',
    CDM: 'YES',           // ACM0002
    PLAN_VIVO: 'NO',
    PURO_EARTH: 'NO',
    ACR: 'YES',
    CAR: 'YES',
  },
};

// ============================================================
// METHOD DATA — 10 methods with prices, yields, IDs, countries
// Sources: Tables 1 & 5 of method_specific_carbon_credit_data.md
//          Table 1 of voluntary_carbon_market_methods.md
//          Table 1 of forest_carbon_sequestration.md
// ============================================================

export const METHODS: Record<MethodId, MethodData> = {
  ARR: {
    id: 'ARR',
    name: 'Afforestation / Reforestation (ARR)',
    emoji: '🌳',
    // EM ARR sub-type: 2022=12.05, 2023=15.74
    priceRange: { min: 12.05, max: 15.74, source: 'EM ARR 2022-2023' },
    yieldRanges: [
      // IPCC temperate: 1.5-4.5 tC/ha/yr = 5.5-16.5 tCO2/ha/yr
      { min: 5.5, max: 16.5, unit: 'tCO₂/ha/yr', biome: 'temperate' },
      // IPCC tropical: 4-8 tC/ha/yr = 14.7-29.3 tCO2/ha/yr
      { min: 14.7, max: 29.3, unit: 'tCO₂/ha/yr', biome: 'tropical' },
      // Boreal: ~4.6 tCO2/ha/yr avg (forest_carbon_sequestration.md, 1.25 tC/ha/yr)
      { min: 4.0, max: 4.6, unit: 'tCO₂/ha/yr', biome: 'boreal' },
    ],
    methodologyIds: {
      VCS: ['VM0047'],
      CDM: ['AR-ACM0003', 'AR-AMS0007'],
      GOLD_STANDARD: ['A/R GHG Emissions Reduction & Sequestration Methodology v2.1'],
      PLAN_VIVO: ['SHAMBA'],
      ACR: ['ACR IFM/Afforestation Methodology'],
      CAR: ['CAR U.S. Forest Projects Protocol'],
    },
    countries: ['Brazil', 'China', 'India', 'Kenya', 'Ethiopia', 'Uganda', 'Chile', 'Uruguay', 'United States', 'United Kingdom'],
  },

  REDD: {
    id: 'REDD',
    name: 'Avoided Deforestation (REDD+)',
    emoji: '🛡️',
    // EM REDD+ 2022=10.19, 2023=7.87
    priceRange: { min: 7.87, max: 10.19, source: 'EM REDD+ 2022-2023' },
    yieldRanges: [
      // Forest restoration review: 9.1-18.8 tCO2/ha/yr for large tropical natural regen
      // Used in REDD+ baselines. REDD+ yield per se is UNVERIFIED but these are reference values.
      { min: 9.1, max: 18.8, unit: 'tCO₂/ha/yr', biome: 'tropical' },
    ],
    methodologyIds: {
      VCS: ['VM0007', 'VM0048'],
      PLAN_VIVO: ['Community Forest Conservation'],
      ACR: ['ACR REDD+ Methodology'],
    },
    countries: ['Brazil', 'Peru', 'Colombia', 'Indonesia', 'DRC', 'Tanzania', 'Cambodia', 'Papua New Guinea', 'Mexico', 'Guyana'],
  },

  BLUE_CARBON: {
    id: 'BLUE_CARBON',
    name: 'Mangrove / Blue Carbon Restoration',
    emoji: '🌊',
    // EM Blue Carbon 2022=11.58, 2023=8.33; Platts 2025 Delta Blue Carbon-1 at 30.50
    priceRange: { min: 8.33, max: 30.50, source: 'EM Blue Carbon 2022-2023, S&P Platts 2025' },
    yieldRanges: [
      // Alongi 2014 average: ~4.8 tCO2/ha/yr
      // Young/restored mangroves: 23.8-38.5 tCO2/ha/yr (plantation)
      // Net additional from VM0033 PDDs: 5-15 tCO2/ha/yr
      { min: 4.8, max: 38.5, unit: 'tCO₂/ha/yr', biome: 'mangrove' },
    ],
    methodologyIds: {
      VCS: ['VM0033'],
      PLAN_VIVO: ['Mangrove Community Restoration'],
    },
    countries: ['Kenya', 'Indonesia', 'Colombia', 'Madagascar', 'Pakistan', 'Mozambique', 'Vietnam', 'Mexico'],
  },

  COOKSTOVES: {
    id: 'COOKSTOVES',
    name: 'Improved Cookstoves',
    emoji: '🍳',
    // EM Household Devices 2022=8.55, 2023=7.70; Platts 2023 range 4.75-8.00
    priceRange: { min: 4.75, max: 8.55, source: 'EM 2022-2023, S&P Platts 2023' },
    yieldRanges: [
      // Berkouwer & Dean: ~3.5 tCO2e/stove/yr
      // Methodology baselines: 3-9 tCO2e/stove/yr depending on context
      { min: 3.0, max: 9.0, unit: 'tCO₂e/stove/yr', biome: undefined },
    ],
    methodologyIds: {
      VCS: ['VM0050'],
      CDM: ['AMS-II.G', 'AMS-I.E'],
      GOLD_STANDARD: ['Simplified Methodology for Clean and Efficient Cookstoves v3.0 (methodology 408)'],
      ACR: ['Energy efficiency measures in thermal applications of non-renewable biomass'],
    },
    countries: ['Kenya', 'Uganda', 'Rwanda', 'Tanzania', 'Ghana', 'India', 'Nepal', 'Bangladesh', 'Cambodia', 'Guatemala'],
  },

  BIOCHAR: {
    id: 'BIOCHAR',
    name: 'Biochar Carbon Removal',
    emoji: '🔥',
    // Platts 2024-2025: US biochar 140-160, EU 170-180
    priceRange: { min: 140, max: 180, source: 'S&P Platts 2024-2025' },
    yieldRanges: [
      // LCA: 2.57-3.26 tCO2e per tonne biochar
      { min: 2.57, max: 3.26, unit: 'tCO₂e/tonne biochar', biome: undefined },
    ],
    methodologyIds: {
      VCS: ['VM0044'],
      PURO_EARTH: ['Puro Standard Biochar Methodology'],
      CAR: ['U.S. and Canada Biochar v1.0'],
    },
    countries: ['United States', 'Canada', 'Germany', 'Sweden', 'Finland', 'India', 'Brazil'],
  },

  DAC: {
    id: 'DAC',
    name: 'Direct Air Capture (DACCS)',
    emoji: '🏭',
    // Platts Tech Carbon Capture basket: 125-140 (2024-2025)
    priceRange: { min: 125, max: 140, source: 'S&P Platts 2024-2025' },
    yieldRanges: [
      // Plant capacity: 4,000-100,000 tCO2/yr
      { min: 4000, max: 100000, unit: 'tCO₂/yr (plant capacity)', biome: undefined },
    ],
    methodologyIds: {
      PURO_EARTH: ['Geologically Stored Carbon (GSC) Methodology'],
    },
    countries: ['Iceland', 'United States', 'Canada', 'United Kingdom'],
  },

  SOIL_CARBON: {
    id: 'SOIL_CARBON',
    name: 'Soil Carbon Sequestration',
    emoji: '🌾',
    // EM Agriculture 2022=11.02, 2023=6.51
    priceRange: { min: 6.51, max: 11.02, source: 'EM Agriculture 2022-2023' },
    yieldRanges: [
      // OECD / FAO: 0.2-0.5 tC/ha/yr = 0.73-1.83 tCO2/ha/yr
      { min: 0.73, max: 1.83, unit: 'tCO₂/ha/yr', biome: undefined },
    ],
    methodologyIds: {
      VCS: ['VM0042'],
      GOLD_STANDARD: ['Agriculture Land Use Methodology'],
      ACR: ['Soil Enrichment Protocol'],
      PLAN_VIVO: ['SHAMBA'],
    },
    countries: ['United States', 'Australia', 'Kenya', 'Tanzania', 'Uganda', 'Brazil', 'Argentina', 'South Africa', 'France', 'Canada'],
  },

  AGROFORESTRY: {
    id: 'AGROFORESTRY',
    name: 'Agroforestry',
    emoji: '🌴',
    // EM Agriculture 2022=11.02, 2023=6.51; Forestry 2022=10.14, 2023=9.72
    priceRange: { min: 6.51, max: 11.02, source: 'EM Agriculture/Forestry 2022-2023' },
    yieldRanges: [
      // Forest restoration synthesis: 10.8-15.6 tCO2/ha/yr tropical
      { min: 10.8, max: 15.6, unit: 'tCO₂/ha/yr', biome: 'tropical' },
      // Temperate/general: 1.5-7.0 tCO2/ha/yr (IPCC, Nair et al.)
      { min: 1.5, max: 7.0, unit: 'tCO₂/ha/yr', biome: 'temperate' },
    ],
    methodologyIds: {
      PLAN_VIVO: ['SHAMBA', 'Plan Vivo Certificates'],
      GOLD_STANDARD: ['A/R and NCS Scope Methodology'],
      VCS: ['VM0047', 'VM0042'],
      CDM: ['AR-ACM0003'],
      ACR: ['ACR Agroforestry Methodology'],
      CAR: ['CAR Forest Projects Protocol'],
    },
    countries: ['Ethiopia', 'Kenya', 'Malawi', 'Tanzania', 'Uganda', 'India', 'Indonesia', 'Peru', 'Brazil'],
  },

  LANDFILL_GAS: {
    id: 'LANDFILL_GAS',
    name: 'Landfill Gas Capture',
    emoji: '♻️',
    // EM Waste Disposal 2022=7.23, 2023=7.48; Turkish credits at 4.50
    priceRange: { min: 4.50, max: 7.48, source: 'EM Waste Disposal 2022-2023, S&P Platts 2024' },
    yieldRanges: [
      // Site-specific: 100k-300k tCO2e/yr
      { min: 100000, max: 300000, unit: 'tCO₂e/yr (site capacity)', biome: undefined },
    ],
    methodologyIds: {
      CDM: ['ACM0001', 'AMS-III.G'],
      VCS: ['VMR0016'],
      ACR: ['Landfill Gas Destruction and Beneficial Use'],
      CAR: ['U.S. Landfill Project Protocol'],
    },
    countries: ['United States', 'Canada', 'Brazil', 'Turkey', 'China', 'Mexico'],
  },

  RENEWABLE_ENERGY: {
    id: 'RENEWABLE_ENERGY',
    name: 'Renewable Energy Displacement',
    emoji: '⚡',
    // EM RE 2022=4.16, 2023=3.88; ASEAN 1.40; range 0.50-5.00
    priceRange: { min: 1.40, max: 4.16, source: 'EM RE 2022-2023, S&P Platts 2024' },
    yieldRanges: [
      // Highly variable by grid; no universal per-MW value
      { min: 50000, max: 500000, unit: 'tCO₂e/yr (plant output)', biome: undefined },
    ],
    methodologyIds: {
      CDM: ['ACM0002'],
      VCS: ['RE Methodology (various)'],
      GOLD_STANDARD: ['Grid-connected RE Methodology'],
      ACR: ['ACR Renewable Energy Methodology'],
      CAR: ['CAR Renewable Energy Protocol'],
    },
    countries: ['China', 'India', 'Brazil', 'Turkey', 'South Africa', 'Mexico', 'Chile', 'Vietnam', 'Thailand'],
  },
};

// ============================================================
// STANDARD DISPLAY NAMES
// ============================================================

export const STANDARD_NAMES: Record<StandardId, string> = {
  VCS: 'Verra VCS',
  GOLD_STANDARD: 'Gold Standard',
  CDM: 'CDM (UNFCCC)',
  PLAN_VIVO: 'Plan Vivo',
  PURO_EARTH: 'Puro.earth',
  ACR: 'American Carbon Registry (ACR)',
  CAR: 'Climate Action Reserve (CAR)',
};

// ============================================================
// VIOLATION TYPES for scam generation
// ============================================================

export type ViolationType =
  | 'WRONG_STANDARD'
  | 'WRONG_METHODOLOGY_ID'
  | 'PRICE_OUT_OF_RANGE'
  | 'YIELD_IMPOSSIBLE'
  | 'WRONG_COUNTRY'
  | 'VOLUME_INCONSISTENT'
  | 'FRAUD_PATTERN';

export interface ViolationTemplate {
  type: ViolationType;
  description: string;
  difficulty: 1 | 2 | 3; // 1=easy, 2=medium, 3=hard
}

export const VIOLATION_TEMPLATES: ViolationTemplate[] = [
  // Easy violations (Day 1-10)
  { type: 'WRONG_COUNTRY', description: 'Country is impossible for this method/biome', difficulty: 1 },
  { type: 'PRICE_OUT_OF_RANGE', description: 'Price is wildly outside documented range', difficulty: 1 },
  { type: 'WRONG_STANDARD', description: 'Standard explicitly does NOT accept this method', difficulty: 1 },

  // Medium violations (Day 11-20)
  { type: 'WRONG_METHODOLOGY_ID', description: 'Methodology ID belongs to a different method', difficulty: 2 },
  { type: 'YIELD_IMPOSSIBLE', description: 'Yield is outside documented range for this biome', difficulty: 2 },
  { type: 'VOLUME_INCONSISTENT', description: 'Volume does not match area x yield math', difficulty: 2 },

  // Hard violations (Day 21-30)
  { type: 'FRAUD_PATTERN', description: 'Description contains documented red-flag pattern', difficulty: 3 },
  { type: 'WRONG_METHODOLOGY_ID', description: 'Subtle methodology version mismatch', difficulty: 3 },
  { type: 'YIELD_IMPOSSIBLE', description: 'Yield is slightly above documented maximum', difficulty: 3 },
];

// ============================================================
// WRONG METHODOLOGY CROSS-REFERENCE
// For generating scam projects with wrong methodology IDs
// Maps from a method to methodology IDs that belong to OTHER methods
// ============================================================

export const WRONG_METHODOLOGY_MAP: Record<MethodId, { id: string; standard: StandardId; realMethod: MethodId }[]> = {
  ARR: [
    { id: 'VM0007', standard: 'VCS', realMethod: 'REDD' },
    { id: 'VM0033', standard: 'VCS', realMethod: 'BLUE_CARBON' },
    { id: 'ACM0001', standard: 'CDM', realMethod: 'LANDFILL_GAS' },
  ],
  REDD: [
    { id: 'VM0047', standard: 'VCS', realMethod: 'ARR' },
    { id: 'VM0044', standard: 'VCS', realMethod: 'BIOCHAR' },
    { id: 'VM0042', standard: 'VCS', realMethod: 'SOIL_CARBON' },
  ],
  BLUE_CARBON: [
    { id: 'VM0007', standard: 'VCS', realMethod: 'REDD' },
    { id: 'VM0047', standard: 'VCS', realMethod: 'ARR' },
  ],
  COOKSTOVES: [
    { id: 'VM0042', standard: 'VCS', realMethod: 'SOIL_CARBON' },
    { id: 'ACM0002', standard: 'CDM', realMethod: 'RENEWABLE_ENERGY' },
    { id: 'VM0033', standard: 'VCS', realMethod: 'BLUE_CARBON' },
  ],
  BIOCHAR: [
    { id: 'VM0050', standard: 'VCS', realMethod: 'COOKSTOVES' },
    { id: 'VM0042', standard: 'VCS', realMethod: 'SOIL_CARBON' },
  ],
  DAC: [
    { id: 'VM0044', standard: 'VCS', realMethod: 'BIOCHAR' },
    { id: 'VM0047', standard: 'VCS', realMethod: 'ARR' },
  ],
  SOIL_CARBON: [
    { id: 'AMS-II.G', standard: 'CDM', realMethod: 'COOKSTOVES' },
    { id: 'VM0044', standard: 'VCS', realMethod: 'BIOCHAR' },
  ],
  AGROFORESTRY: [
    { id: 'VM0007', standard: 'VCS', realMethod: 'REDD' },
    { id: 'VM0033', standard: 'VCS', realMethod: 'BLUE_CARBON' },
  ],
  LANDFILL_GAS: [
    { id: 'AMS-II.G', standard: 'CDM', realMethod: 'COOKSTOVES' },
    { id: 'ACM0002', standard: 'CDM', realMethod: 'RENEWABLE_ENERGY' },
  ],
  RENEWABLE_ENERGY: [
    { id: 'ACM0001', standard: 'CDM', realMethod: 'LANDFILL_GAS' },
    { id: 'AMS-II.G', standard: 'CDM', realMethod: 'COOKSTOVES' },
  ],
};

// ============================================================
// IMPOSSIBLE COUNTRY PAIRS
// For generating easy scam projects
// ============================================================

export const IMPOSSIBLE_COUNTRIES: Record<MethodId, string[]> = {
  ARR: ['Iceland', 'Greenland'],
  REDD: ['Iceland', 'Norway', 'Switzerland', 'Finland', 'Japan'],
  BLUE_CARBON: ['Switzerland', 'Austria', 'Czech Republic', 'Mongolia', 'Nepal'],
  COOKSTOVES: ['Norway', 'Switzerland', 'Japan', 'Australia', 'Germany'],
  BIOCHAR: [],  // Biochar can theoretically be anywhere
  DAC: ['Madagascar', 'Chad', 'Somalia', 'Laos'],
  SOIL_CARBON: [],  // Soil carbon can be anywhere with agriculture
  AGROFORESTRY: ['Iceland', 'Greenland', 'Antarctica'],
  LANDFILL_GAS: [],
  RENEWABLE_ENERGY: [],
};

// ============================================================
// FICTITIOUS AUDITOR NAMES
// ============================================================

export const AUDITOR_NAMES = [
  'Meridian Assurance',
  'GreenPath Certification',
  'TerraVerify Group',
  'ClimateGuard Auditors',
  'Equinox Standards',
  'Arbor Compliance',
  'CarbonScope International',
  'Verdant Validation',
  'PrimeEarth Assurance',
  'NorthStar Audit Partners',
  'BlueHorizon Verification',
  'Canopy Trust Auditors',
  'Solstice Quality Group',
  'RootBridge Certification',
  'ClearSky Compliance',
];

// ============================================================
// PROJECT NAME COMPONENTS
// ============================================================

export const PROJECT_NAME_PARTS = {
  prefixes: [
    'Green', 'Terra', 'Eco', 'Bio', 'Carbon', 'Verdant', 'Azure',
    'Emerald', 'Pacific', 'Atlantic', 'Sierra', 'Canopy', 'Horizon',
    'Forest', 'Sunrise', 'Savanna', 'Highland', 'Coastal', 'Valley',
    'Monsoon', 'Pinnacle', 'Summit', 'Riverine', 'Cerrado', 'Mekong',
    'Andes', 'Borneo', 'Congo', 'Sahel', 'Nordic', 'Cascade',
  ],
  suffixes: [
    'Project', 'Initiative', 'Program', 'Alliance', 'Foundation',
    'Restoration', 'Conservation', 'Solutions', 'Carbon Fund',
    'Green Belt', 'Corridor', 'Reserve', 'Partnership', 'Venture',
  ],
  methodWords: {
    ARR: ['Reforestation', 'Planting', 'Forest Revival', 'Tree Cover'],
    REDD: ['Forest Shield', 'Deforestation Guard', 'Rainforest Protection', 'Forest Watch'],
    BLUE_CARBON: ['Mangrove', 'Coastal Blue', 'Tidal', 'Wetland'],
    COOKSTOVES: ['Cookstove', 'Clean Cooking', 'Stove', 'Household Energy'],
    BIOCHAR: ['Biochar', 'Pyrogenic Carbon', 'Char Carbon'],
    DAC: ['Air Capture', 'Atmospheric Removal', 'DAC', 'Direct Capture'],
    SOIL_CARBON: ['Soil Restoration', 'Regenerative Ag', 'Soil Health', 'Cropland Carbon'],
    AGROFORESTRY: ['Agroforestry', 'Shade Tree', 'Farm Forest', 'Silvopasture'],
    LANDFILL_GAS: ['Methane Recovery', 'Landfill Energy', 'Waste Gas', 'LFG Capture'],
    RENEWABLE_ENERGY: ['Wind Farm', 'Solar Array', 'Hydro', 'Clean Energy'],
  } as Record<MethodId, string[]>,
};

// ============================================================
// BIOME/YIELD LOOKUP — for validating volume = area * yield
// ============================================================

export const BIOME_YIELDS: Record<string, { min: number; max: number }> = {
  // From forest_carbon_sequestration.md Table 1
  'tropical_rainforest': { min: 4.8, max: 22.0 },       // Secondary 4.8-11, intact up to 22
  'peatland': { min: 3.7, max: 7.3 },                    // 1-2 tC/ha/yr
  'mangrove': { min: 4.8, max: 38.5 },                   // Alongi average to plantation max
  'temperate_deciduous': { min: 9.2, max: 25.7 },        // 2.5-7 tC/ha/yr
  'boreal': { min: 4.0, max: 4.6 },                      // ~1.25 tC/ha/yr
  'agroforestry_tropical': { min: 10.8, max: 15.6 },     // Forest restoration synthesis
  'agroforestry_temperate': { min: 1.5, max: 7.0 },      // IPCC/Nair
  'bamboo': { min: 10.0, max: 44.0 },                    // Fast-growing bamboo stands
  'soil_agricultural': { min: 0.73, max: 1.83 },         // OECD/FAO
};

// ============================================================
// COUNTRY → BIOME MAPPING
// Used to pick the correct yield range for ARR & Agroforestry
// ============================================================

export const COUNTRY_BIOME: Record<string, 'tropical' | 'temperate' | 'boreal'> = {
  // Tropical
  'Brazil': 'tropical',
  'India': 'tropical',
  'Kenya': 'tropical',
  'Ethiopia': 'tropical',
  'Uganda': 'tropical',
  'Indonesia': 'tropical',
  'Philippines': 'tropical',
  'Colombia': 'tropical',
  'Peru': 'tropical',
  'DRC': 'tropical',
  'Tanzania': 'tropical',
  'Cambodia': 'tropical',
  'Papua New Guinea': 'tropical',
  'Guyana': 'tropical',
  'Madagascar': 'tropical',
  'Pakistan': 'tropical',
  'Mozambique': 'tropical',
  'Vietnam': 'tropical',
  'Mexico': 'tropical',
  'Malawi': 'tropical',
  'Nepal': 'tropical',
  'Rwanda': 'tropical',
  'Ghana': 'tropical',
  'Bangladesh': 'tropical',
  'Guatemala': 'tropical',
  'Costa Rica': 'tropical',
  'Thailand': 'tropical',
  // Temperate
  'China': 'temperate',
  'Chile': 'temperate',
  'Uruguay': 'temperate',
  'United States': 'temperate',
  'United Kingdom': 'temperate',
  'France': 'temperate',
  'Germany': 'temperate',
  'Serbia': 'temperate',
  'Australia': 'temperate',
  'Argentina': 'temperate',
  'South Africa': 'temperate',
  'Turkey': 'temperate',
  'Canada': 'temperate',
  // Boreal
  'Sweden': 'boreal',
  'Norway': 'boreal',
  'Iceland': 'boreal',
  'Finland': 'boreal',
};

// Helper: get valid standards for a method
export function getValidStandards(method: MethodId): StandardId[] {
  const row = SCOPE_MATRIX[method];
  return (Object.keys(row) as StandardId[]).filter(s => row[s] === 'YES');
}

// Helper: get standards that explicitly reject a method
export function getInvalidStandards(method: MethodId): StandardId[] {
  const row = SCOPE_MATRIX[method];
  return (Object.keys(row) as StandardId[]).filter(s => row[s] === 'NO');
}

// Helper: check if a standard accepts a method
export function isValidStandard(method: MethodId, standard: StandardId): boolean {
  return SCOPE_MATRIX[method][standard] === 'YES';
}
