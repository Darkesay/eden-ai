import { SqliteDriver } from './sqliteDriver.ts';
import { calculateVpdKpa, type PlatformRepositories } from './repositories.ts';
import { generateSecureId, redactSecretsFromText } from './telemetryContract.ts';

export const CANONICAL_GROWTH_STAGES = [
  'germination',
  'seedling',
  'vegetative',
  'flowering',
  'fruiting',
  'harvest'
] as const;

export type CanonicalGrowthStage = (typeof CANONICAL_GROWTH_STAGES)[number];

export interface NutrientRequirementSpec {
  npkRatio: string;
  nitrogenPpm: [number, number];
  phosphorusPpm: [number, number];
  potassiumPpm: [number, number];
  calciumPpm: [number, number];
  magnesiumPpm: [number, number];
  guidance: string;
}

export interface EnrichedStageStandard {
  id: string;
  cropProfileId: string;
  stageName: CanonicalGrowthStage;
  stageOrder: number;
  dayStart: number;
  dayEnd: number;
  expectedDurationDays: number;
  tempMinC: number;
  tempOptimalC: number;
  tempMaxC: number;
  humidityMinPct: number;
  humidityOptimalPct: number;
  humidityMaxPct: number;
  soilMoistureMinPct: number;
  soilMoistureOptimalPct: number;
  soilMoistureMaxPct: number;
  phMin: number;
  phMax: number;
  ecMinMs: number;
  ecMaxMs: number;
  vpdMinKpa: number;
  vpdMaxKpa: number;
  lightDliMin: number;
  lightDliMax: number;
  lightHoursMin: number;
  lightHoursMax: number;
  irrigationNotes: string;
  nutrientRequirements: NutrientRequirementSpec;
  stressIndicators: string[];
  sourceOrganization: string;
  publicationDate: string;
  validationStatus: 'verified' | 'provisional';
  confidenceLevel: 'verified_reference' | 'provisional_polyhouse_adaptation';
  citationRefs: string[];
}

export interface EnrichedCropProfile {
  id: string;
  cropCode: string;
  commonName: string;
  localNames: string[];
  scientificName: string;
  variety: string;
  cultivationMethod: string;
  standardDaysToHarvest: number;
  summary: string;
  riskProfile: Record<string, unknown>;
  evidenceReferences: Array<{
    organization: string;
    title: string;
    publicationDate: string;
    validationStatus: 'verified' | 'provisional';
  }>;
  confidenceLevel: string;
  validationStatus: 'verified' | 'provisional';
  stages: EnrichedStageStandard[];
}

export interface EightPointRecommendationExplanation {
  whatIsHappening: string;
  supportingEvidence: string;
  recommendedAction: string;
  whyRecommended: string;
  consequenceOfInaction: string;
  possibleRisks: string;
  systemConfidence: {
    score: number;
    label: 'High' | 'Moderate' | 'Low — Stale/Unverified Data' | 'Simulation Sandbox';
    dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
    calibrationBasis: string;
  };
  verificationPlan: {
    targetMetric: string;
    baselineValue: number | boolean | null;
    expectedDirection: 'increase' | 'decrease' | 'stabilize' | 'close_lock';
    expectedDeltaRange: string;
    verificationWindowSeconds: number;
    successCriteria: string;
  };
}

export interface EvaluatedCropRecommendation {
  id?: string;
  agentName: string;
  category:
    | 'IRRIGATION_PULSE'
    | 'VENTILATION_COOLING'
    | 'HUMIDITY_VENTING'
    | 'SUPPLEMENTAL_HEATING'
    | 'SUPPLEMENTAL_LIGHTING'
    | 'RAIN_ROOF_PROTECTION'
    | 'NUTRIENT_ADVISORY';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidenceScore: number;
  dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
  cropCode: string;
  cropVariety: string;
  growthStage: CanonicalGrowthStage;
  observationSummary: string;
  proposedAction: {
    targetEquipment: 'pump' | 'fan' | 'heater' | 'grow_light' | 'roof_vent' | 'manual_fertigation';
    commandType: string;
    desiredState: 'on' | 'off' | 'closed' | 'open';
    durationSeconds: number;
    actuatableInSimulation: boolean;
  };
  expectedOutcome: {
    metric: string;
    expectedDelta: number;
    unit: string;
    verificationWindowSeconds: number;
  };
  explanation: EightPointRecommendationExplanation;
  evidence: Record<string, unknown>;
}

interface SeedCropDefinition {
  cropCode: string;
  commonName: string;
  localNames: string[];
  scientificName: string;
  variety: string;
  cultivationMethod: string;
  standardDaysToHarvest: number;
  summary: string;
  validationStatus: 'verified' | 'provisional';
  confidenceLevel: 'verified_reference' | 'provisional_polyhouse_adaptation';
  sourceOrganization: string;
  publicationDate: string;
  evidenceReferences: Array<{
    organization: string;
    title: string;
    publicationDate: string;
    validationStatus: 'verified' | 'provisional';
  }>;
  baseTemp: [number, number, number]; // min, opt, max vegetative
  baseRh: [number, number, number];
  baseSoil: [number, number, number];
  phRange: [number, number];
  ecRange: [number, number]; // vegetative baseline
  dliRange: [number, number];
  photoperiodHours: [number, number];
  stageDurations: [number, number, number, number, number, number]; // 6 stages summing ~daysToHarvest
  leafyCrop?: boolean;
}

const SEED_CATALOG: SeedCropDefinition[] = [
  {
    cropCode: 'tomato',
    commonName: 'Greenhouse Tomato',
    localNames: ['Tumatir (Hausa)', 'Tomati (Yoruba)', 'Tomato (Igbo)'],
    scientificName: 'Solanum lycopersicum',
    variety: 'Padma F1',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 95,
    summary:
      'Heat-tolerant tropical hybrid indeterminate tomato bred for humid and savanna protected polyhouses across Nigeria.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'FAO & NIHORT Nigeria',
    publicationDate: '2021-06',
    evidenceReferences: [
      {
        organization: 'FAO',
        title: 'Good Agricultural Practices for Greenhouse Vegetable Production (FAO Plant Production Paper 230)',
        publicationDate: '2017-05',
        validationStatus: 'verified'
      },
      {
        organization: 'NIHORT Ibadan',
        title: 'Protected & Irrigated Tomato Production Guide for Nigerian Agro-Ecological Zones',
        publicationDate: '2021-06',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [20, 25, 29],
    baseRh: [58, 66, 75],
    baseSoil: [52, 62, 72],
    phRange: [5.8, 6.6],
    ecRange: [1.8, 2.8],
    dliRange: [16, 26],
    photoperiodHours: [12, 14],
    stageDurations: [7, 18, 25, 18, 17, 10]
  },
  {
    cropCode: 'tomato',
    commonName: 'Plum Tomato',
    localNames: ['Tumatir Dan Zaria (Hausa)', 'Tomati (Yoruba)', 'Tomato (Igbo)'],
    scientificName: 'Solanum lycopersicum',
    variety: 'Roma VF',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 85,
    summary:
      'Determinate processing and fresh-market plum tomato widely cultivated across Kaduna, Kano, Plateau, and Oyo.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'NIHORT Ibadan & FAO Paper 56',
    publicationDate: '2019-11',
    evidenceReferences: [
      {
        organization: 'NIHORT Ibadan',
        title: 'Roma VF & Savanna Determinate Tomato Extension Bulletin',
        publicationDate: '2019-11',
        validationStatus: 'verified'
      },
      {
        organization: 'FAO',
        title: 'Crop Evapotranspiration — FAO Irrigation and Drainage Paper 56',
        publicationDate: '1998-01',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [19, 24.5, 28.5],
    baseRh: [55, 64, 72],
    baseSoil: [50, 60, 70],
    phRange: [6.0, 6.8],
    ecRange: [1.6, 2.5],
    dliRange: [15, 25],
    photoperiodHours: [11.5, 13.5],
    stageDurations: [6, 16, 22, 16, 15, 10]
  },
  {
    cropCode: 'bell_pepper',
    commonName: 'Sweet Bell Pepper (Tatase)',
    localNames: ['Tatase (Yoruba/Hausa)', 'Ose Oyibo (Igbo)'],
    scientificName: 'Capsicum annuum',
    variety: 'California Wonder',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 85,
    summary:
      'Thick-walled sweet bell pepper sensitive to blossom-end rot under erratic moisture and flower drop above 32°C.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'FAO & IITA Horticulture',
    publicationDate: '2020-04',
    evidenceReferences: [
      {
        organization: 'FAO',
        title: 'Protected Cultivation Capsicum Climate & Fertigation Standards (Paper 230)',
        publicationDate: '2017-05',
        validationStatus: 'verified'
      },
      {
        organization: 'NIHORT Ibadan',
        title: 'Sweet & Hot Pepper Production Manual for Nigeria',
        publicationDate: '2020-04',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [20, 25, 29],
    baseRh: [60, 68, 76],
    baseSoil: [54, 63, 72],
    phRange: [5.8, 6.7],
    ecRange: [1.7, 2.6],
    dliRange: [14, 24],
    photoperiodHours: [12, 14],
    stageDurations: [8, 17, 22, 15, 15, 8]
  },
  {
    cropCode: 'habanero',
    commonName: 'Scotch Bonnet / Habanero (Ata Rodo)',
    localNames: ['Ata Rodo (Yoruba)', 'Attarugu (Hausa)', 'Ose Nsukka (Igbo)'],
    scientificName: 'Capsicum chinense',
    variety: 'Nsukka Yellow / Red Savina',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 95,
    summary:
      'High-aroma Nigerian hot pepper requiring warm root zones, balanced potassium during fruit set, and strict aphid/mite prevention.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'NIHORT Nigeria',
    publicationDate: '2020-09',
    evidenceReferences: [
      {
        organization: 'NIHORT Ibadan',
        title: 'Capsicum chinense (Ata Rodo / Ose Nsukka) Agronomic Package of Practices',
        publicationDate: '2020-09',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [21, 26.5, 31],
    baseRh: [58, 67, 76],
    baseSoil: [50, 60, 70],
    phRange: [5.8, 6.8],
    ecRange: [1.6, 2.5],
    dliRange: [15, 25],
    photoperiodHours: [11.5, 13.5],
    stageDurations: [9, 19, 24, 17, 16, 10]
  },
  {
    cropCode: 'cucumber',
    commonName: 'Greenhouse Slicing Cucumber',
    localNames: ['Gurji (Hausa)', 'Kukumba (Yoruba/Igbo)'],
    scientificName: 'Cucumis sativus',
    variety: 'Darina F1',
    cultivationMethod: 'coco_substrate',
    standardDaysToHarvest: 58,
    summary:
      'Fast-growing parthenocarpic trellised cucumber with high transpiration demand and sensitivity to powdery/downy mildew.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'FAO Protected Cultivation',
    publicationDate: '2017-05',
    evidenceReferences: [
      {
        organization: 'FAO',
        title: 'Greenhouse Cucurbit Climate, VPD & Drip Irrigation Management (Paper 230)',
        publicationDate: '2017-05',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [22, 26, 30],
    baseRh: [65, 73, 82],
    baseSoil: [60, 70, 78],
    phRange: [5.6, 6.5],
    ecRange: [1.6, 2.4],
    dliRange: [14, 22],
    photoperiodHours: [12, 14],
    stageDurations: [4, 10, 14, 10, 12, 8]
  },
  {
    cropCode: 'ugwu',
    commonName: 'Fluted Pumpkin (Ugwu)',
    localNames: ['Ugwu (Igbo)', 'Sokoyokoto-Ugwu / Apiroko (Yoruba)', 'Kabewa Maiuka (Hausa)'],
    scientificName: 'Telfairia occidentalis',
    variety: 'South-East Broadleaf',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 65,
    summary:
      'Perennial-grown indigenous Nigerian leafy vine prized for iron-rich tender shoots; polyhouse VPD/DLI targets adapted from open-field NIHORT trials.',
    validationStatus: 'provisional',
    confidenceLevel: 'provisional_polyhouse_adaptation',
    sourceOrganization: 'NIHORT Ibadan & IITA Indigenous Vegetables (Polyhouse-Adapted)',
    publicationDate: '2021-03',
    evidenceReferences: [
      {
        organization: 'NIHORT Ibadan',
        title: 'Telfairia occidentalis (Ugwu) Dry-Season Irrigated Production Bulletin (Open-Field Verified; Polyhouse VPD Provisional)',
        publicationDate: '2021-03',
        validationStatus: 'provisional'
      }
    ],
    baseTemp: [22, 27, 31],
    baseRh: [62, 72, 82],
    baseSoil: [56, 66, 75],
    phRange: [5.8, 6.8],
    ecRange: [1.2, 2.0],
    dliRange: [12, 20],
    photoperiodHours: [11.5, 13],
    stageDurations: [8, 12, 22, 8, 8, 7],
    leafyCrop: true
  },
  {
    cropCode: 'shoko',
    commonName: 'Lagos Spinach (Shoko Yokoto)',
    localNames: ['Efo Shoko (Yoruba)', 'Farar Alayyahu (Hausa)', 'Eriro (Igbo)'],
    scientificName: 'Celosia argentea',
    variety: 'TLV8 (NIHORT)',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 42,
    summary:
      'Rapid-turnaround Nigerian leafy vegetable harvested for succulent vegetative shoots before plume flowering; polyhouse VPD/EC adapted from NIHORT TLV8 trials.',
    validationStatus: 'provisional',
    confidenceLevel: 'provisional_polyhouse_adaptation',
    sourceOrganization: 'NIHORT Ibadan (TLV8 Cultivar Sheet — Polyhouse Provisional)',
    publicationDate: '2018-08',
    evidenceReferences: [
      {
        organization: 'NIHORT Ibadan',
        title: 'Celosia argentea (TLV8) Leafy Vegetable Production Guide (Polyhouse Microclimate Targets Provisional)',
        publicationDate: '2018-08',
        validationStatus: 'provisional'
      }
    ],
    baseTemp: [22, 27, 31],
    baseRh: [60, 70, 80],
    baseSoil: [55, 65, 74],
    phRange: [6.0, 6.8],
    ecRange: [1.1, 1.8],
    dliRange: [12, 19],
    photoperiodHours: [11.5, 13],
    stageDurations: [5, 9, 14, 5, 4, 5],
    leafyCrop: true
  },
  {
    cropCode: 'okra',
    commonName: 'Okra (Ila)',
    localNames: ['Kubewa (Hausa)', 'Ila (Yoruba)', 'Okwuru (Igbo)'],
    scientificName: 'Abelmoschus esculentus',
    variety: 'NHAe 47-4 / Clemson Spineless',
    cultivationMethod: 'soil_bed',
    standardDaysToHarvest: 60,
    summary:
      'Warm-season mucilaginous pod crop bred by NIHORT (NHAe 47-4) requiring warm germination soil (>22°C) and steady moisture during rapid pod elongation.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'NIHORT Ibadan & FAO',
    publicationDate: '2019-07',
    evidenceReferences: [
      {
        organization: 'NIHORT Ibadan',
        title: 'NHAe 47-4 Early-Maturing Okra Cultivation & Seed Guide',
        publicationDate: '2019-07',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [22, 27.5, 32],
    baseRh: [55, 65, 75],
    baseSoil: [50, 60, 70],
    phRange: [6.0, 6.8],
    ecRange: [1.4, 2.2],
    dliRange: [15, 24],
    photoperiodHours: [11.5, 13],
    stageDurations: [5, 11, 16, 10, 10, 8]
  },
  {
    cropCode: 'lettuce',
    commonName: 'Shade-House Butterhead Lettuce',
    localNames: ['Latas (Hausa)', 'Letusi (Yoruba/Igbo)'],
    scientificName: 'Lactuca sativa',
    variety: 'Rex Butterhead',
    cultivationMethod: 'nft_hydroponic',
    standardDaysToHarvest: 48,
    summary:
      'Cool-preferring leafy salad crop prone to tipburn and premature bolting when canopy temperature exceeds 26°C or VPD rises above 1.2 kPa.',
    validationStatus: 'verified',
    confidenceLevel: 'verified_reference',
    sourceOrganization: 'FAO Hydroponic & Shade-House Leafy Greens',
    publicationDate: '2017-05',
    evidenceReferences: [
      {
        organization: 'FAO',
        title: 'Soilless & Protected Leafy Vegetable Climate Standards (FAO Paper 230)',
        publicationDate: '2017-05',
        validationStatus: 'verified'
      }
    ],
    baseTemp: [16, 20.5, 24.5],
    baseRh: [58, 66, 75],
    baseSoil: [60, 70, 78],
    phRange: [5.6, 6.2],
    ecRange: [1.2, 1.8],
    dliRange: [12, 17],
    photoperiodHours: [12, 14],
    stageDurations: [4, 10, 18, 6, 5, 5],
    leafyCrop: true
  }
];

function buildSixStagesForSeed(def: SeedCropDefinition): Array<Omit<EnrichedStageStandard, 'id' | 'cropProfileId'>> {
  const [tMin, tOpt, tMax] = def.baseTemp;
  const [rhMin, rhOpt, rhMax] = def.baseRh;
  const [smMin, smOpt, smMax] = def.baseSoil;
  const [phMin, phMax] = def.phRange;
  const [ecMin, ecMax] = def.ecRange;
  const [dliMin, dliMax] = def.dliRange;
  const [lhMin, lhMax] = def.photoperiodHours;

  let cursorDay = 1;
  return CANONICAL_GROWTH_STAGES.map((stageName, idx) => {
    const dur = def.stageDurations[idx];
    const dayStart = cursorDay;
    const dayEnd = cursorDay + dur - 1;
    cursorDay = dayEnd + 1;

    // Stage-specific biological adjustments
    let stageTempMin = tMin;
    let stageTempOpt = tOpt;
    let stageTempMax = tMax;
    let stageRhMin = rhMin;
    let stageRhOpt = rhOpt;
    let stageRhMax = rhMax;
    let stageSmMin = smMin;
    let stageSmOpt = smOpt;
    let stageSmMax = smMax;
    let stageEcMin = ecMin;
    let stageEcMax = ecMax;
    let stageVpdMin = 0.75;
    let stageVpdMax = 1.25;
    let stageDliMin = dliMin;
    let stageDliMax = dliMax;
    let irrigationNotes = '';
    let nutrients: NutrientRequirementSpec;
    let stressIndicators: string[] = [];

    if (stageName === 'germination') {
      stageTempMin = Math.round((tMin + 1) * 10) / 10;
      stageTempOpt = Math.round((tOpt + 0.5) * 10) / 10;
      stageRhMin = Math.min(80, rhMin + 12);
      stageRhOpt = Math.min(85, rhOpt + 12);
      stageRhMax = Math.min(90, rhMax + 10);
      stageSmMin = Math.min(72, smMin + 10);
      stageSmOpt = Math.min(78, smOpt + 10);
      stageSmMax = Math.min(84, smMax + 8);
      stageEcMin = 0.4;
      stageEcMax = 0.9;
      stageVpdMin = 0.35;
      stageVpdMax = 0.75;
      stageDliMin = Math.max(6, dliMin - 6);
      stageDliMax = Math.max(10, dliMax - 8);
      irrigationNotes =
        'Fine mist or capillary tray moisture; keep seed zone uniformly moist without anaerobic pooling.';
      nutrients = {
        npkRatio: '0-0-0 / Low-EC Starter',
        nitrogenPpm: [20, 50],
        phosphorusPpm: [20, 40],
        potassiumPpm: [30, 60],
        calciumPpm: [30, 60],
        magnesiumPpm: [10, 25],
        guidance: 'Cotyledons rely on seed reserves; excess EC (>1.0 mS/cm) causes osmotic radicle burn.'
      };
      stressIndicators = [
        'Uneven emergence (>48h spread)',
        'Seed-coat helmet-head from dry media (<55% moisture)',
        'Damping-off hypocotyl constriction under stagnant waterlogged media'
      ];
    } else if (stageName === 'seedling') {
      stageRhMin = Math.min(75, rhMin + 5);
      stageRhOpt = Math.min(78, rhOpt + 4);
      stageRhMax = Math.min(82, rhMax + 4);
      stageSmMin = smMin + 4;
      stageSmOpt = smOpt + 4;
      stageSmMax = smMax + 4;
      stageEcMin = Math.round(ecMin * 0.65 * 10) / 10;
      stageEcMax = Math.round(ecMax * 0.7 * 10) / 10;
      stageVpdMin = 0.55;
      stageVpdMax = 0.95;
      stageDliMin = Math.max(10, dliMin - 3);
      stageDliMax = Math.max(15, dliMax - 4);
      irrigationNotes =
        'Short pulse drip/micro-sprinkler cycles in morning hours; encourage shallow taproot branching.';
      nutrients = {
        npkRatio: '1-2-1 Root Establishment',
        nitrogenPpm: [80, 120],
        phosphorusPpm: [45, 65],
        potassiumPpm: [90, 140],
        calciumPpm: [80, 120],
        magnesiumPpm: [25, 40],
        guidance: 'Available phosphorus and calcium drive fibrous root hair initiation and sturdy stem caliper.'
      };
      stressIndicators = [
        'Etiolated spindly internodes (low DLI)',
        'Purpling underside of cotyledons/first true leaves (cool root zone or P lock-out)',
        'Wilting at midday under VPD > 1.2 kPa'
      ];
    } else if (stageName === 'vegetative') {
      stageVpdMin = 0.8;
      stageVpdMax = 1.2;
      irrigationNotes =
        'Regular morning + early-afternoon drip pulses matched to solar radiation; maintain 10–15% drainage target.';
      nutrients = {
        npkRatio: '3-1-2 Canopy Expansion',
        nitrogenPpm: [140, 190],
        phosphorusPpm: [45, 60],
        potassiumPpm: [160, 220],
        calciumPpm: [120, 170],
        magnesiumPpm: [40, 55],
        guidance: 'Balanced nitrate-nitrogen and magnesium support rapid chlorophyll synthesis and leaf area expansion.'
      };
      stressIndicators = [
        'Pale lower-leaf chlorosis (nitrogen deficit)',
        'Upward leaf-margin curling under canopy heat (>30°C) or high VPD (>1.4 kPa)',
        'Edema / fungal leaf spots when night RH stays >82% without air circulation'
      ];
    } else if (stageName === 'flowering') {
      stageTempMax = Math.round((tMax - 1.0) * 10) / 10;
      stageRhMin = Math.max(50, rhMin - 3);
      stageRhMax = Math.min(74, rhMax - 3);
      stageEcMin = Math.round((ecMin + 0.2) * 10) / 10;
      stageEcMax = Math.round((ecMax + 0.3) * 10) / 10;
      stageVpdMin = 0.85;
      stageVpdMax = 1.3;
      irrigationNotes = def.leafyCrop
        ? 'For leafy harvest, pinch flower buds or maintain cool moist root zone to delay bolting; for seed production, avoid overhead wetting.'
        : 'Avoid sudden moisture swings during anthesis; keep daytime RH 55–70% for viable pollen shed.';
      nutrients = {
        npkRatio: '2-2-3 Anthesis & Pollen Viability',
        nitrogenPpm: [120, 160],
        phosphorusPpm: [50, 70],
        potassiumPpm: [200, 270],
        calciumPpm: [140, 190],
        magnesiumPpm: [45, 60],
        guidance: def.leafyCrop
          ? 'Keep nitrate balanced; heat/drought spikes trigger premature bolting and bitter leaf latex.'
          : 'Moderate nitrogen to prevent vegetative flower abortion; maintain boron + calcium availability.'
      };
      stressIndicators = def.leafyCrop
        ? ['Premature stalk elongation (bolting) above target temperature', 'Leaf bitterness & toughness']
        : [
            'Blossom drop / sterile pollen when canopy exceeds max stage temperature',
            'Clumped non-viable pollen when RH > 80%',
            'Botrytis gray mold on senescing petals'
          ];
    } else if (stageName === 'fruiting') {
      stageRhMin = Math.max(50, rhMin - 3);
      stageRhMax = Math.min(74, rhMax - 2);
      stageSmMin = smMin + 2;
      stageSmOpt = smOpt + 2;
      stageEcMin = Math.round((ecMin + 0.4) * 10) / 10;
      stageEcMax = Math.round((ecMax + 0.6) * 10) / 10;
      stageVpdMin = 0.9;
      stageVpdMax = 1.35;
      irrigationNotes = def.leafyCrop
        ? 'Applies only to seed-mother beds: steady root-zone drip irrigation without wetting developing seed pods.'
        : 'High peak transpiration; deliver frequent smaller drip pulses so moisture never swings >12% (prevents fruit cracking & blossom-end rot).';
      nutrients = {
        npkRatio: '2-1-4 Fruit Fill & Calcium Transport',
        nitrogenPpm: [130, 170],
        phosphorusPpm: [45, 65],
        potassiumPpm: [240, 320],
        calciumPpm: [160, 210],
        magnesiumPpm: [50, 65],
        guidance:
          'Elevated potassium drives sugar translocation and fruit firmness; continuous transpiration airflow is mandatory to move calcium into developing fruit.'
      };
      stressIndicators = def.leafyCrop
        ? ['Seed-pod mildew under high night humidity', 'Uneven seed fill under moisture deficit']
        : [
            'Blossom-end rot (dark sunken distal lesion from low moisture or VPD lock-out blocking Ca uptake)',
            'Radial/concentric fruit skin cracking after dry-to-wet irrigation spikes',
            'Sunscald bleaching on exposed fruit above max temperature'
          ];
    } else {
      // harvest
      stageRhMin = Math.max(50, rhMin - 5);
      stageRhMax = Math.min(72, rhMax - 4);
      stageSmMin = Math.max(42, smMin - 5);
      stageSmOpt = Math.max(50, smOpt - 5);
      stageSmMax = Math.max(60, smMax - 5);
      stageEcMin = Math.round((ecMin + 0.2) * 10) / 10;
      stageEcMax = Math.round((ecMax + 0.3) * 10) / 10;
      stageVpdMin = 0.9;
      stageVpdMax = 1.35;
      irrigationNotes =
        'Harvest in cool early-morning hours for peak turgor; avoid heavy late-day irrigation that causes fruit splitting or post-harvest rot.';
      nutrients = {
        npkRatio: '1-1-3 Ripening & Shelf-Life',
        nitrogenPpm: [90, 130],
        phosphorusPpm: [35, 55],
        potassiumPpm: [200, 280],
        calciumPpm: [130, 180],
        magnesiumPpm: [40, 55],
        guidance:
          'Taper excess nitrogen prior to harvest to improve post-harvest shelf life, Brix sweetness, and firm epidermal tissue.'
      };
      stressIndicators = [
        'Post-harvest soft rot from high canopy condensation during picking',
        'Fruit splitting from over-irrigation near breaker/ripe stage',
        'Rapid wilting if harvested during hot afternoon VPD peak'
      ];
    }

    return {
      stageName,
      stageOrder: idx + 1,
      dayStart,
      dayEnd,
      expectedDurationDays: dur,
      tempMinC: stageTempMin,
      tempOptimalC: stageTempOpt,
      tempMaxC: stageTempMax,
      humidityMinPct: stageRhMin,
      humidityOptimalPct: stageRhOpt,
      humidityMaxPct: stageRhMax,
      soilMoistureMinPct: stageSmMin,
      soilMoistureOptimalPct: stageSmOpt,
      soilMoistureMaxPct: stageSmMax,
      phMin,
      phMax,
      ecMinMs: stageEcMin,
      ecMaxMs: stageEcMax,
      vpdMinKpa: stageVpdMin,
      vpdMaxKpa: stageVpdMax,
      lightDliMin: stageDliMin,
      lightDliMax: stageDliMax,
      lightHoursMin: lhMin,
      lightHoursMax: lhMax,
      irrigationNotes,
      nutrientRequirements: nutrients,
      stressIndicators,
      sourceOrganization: def.sourceOrganization,
      publicationDate: def.publicationDate,
      validationStatus: def.validationStatus,
      confidenceLevel: def.confidenceLevel,
      citationRefs: def.evidenceReferences.map((r) => `${r.organization} (${r.publicationDate}): ${r.title}`)
    };
  });
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class CropIntelligenceEngine {
  private readonly driver: SqliteDriver;
  private readonly repos: PlatformRepositories;
  private catalogSeeded = false;

  constructor(driver: SqliteDriver, repos: PlatformRepositories) {
    this.driver = driver;
    this.repos = repos;
  }

  public ensureCatalogSeeded(): void {
    if (this.catalogSeeded) return;

    const countRow = this.driver.queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM crop_growth_stage_standards WHERE nutrient_requirements_json != '{}'"
    );
    if (Number(countRow?.c || 0) >= SEED_CATALOG.length * CANONICAL_GROWTH_STAGES.length) {
      this.catalogSeeded = true;
      return;
    }

    this.driver.runInTransaction(() => {
      const nowIso = new Date().toISOString();
      for (const def of SEED_CATALOG) {
        const profile = this.repos.cropKnowledge.upsertCropKnowledgeProfile({
          cropCode: def.cropCode,
          commonName: def.commonName,
          localNames: def.localNames,
          scientificName: def.scientificName,
          variety: def.variety,
          cultivationMethod: def.cultivationMethod,
          standardDaysToHarvest: def.standardDaysToHarvest,
          summary: def.summary,
          riskProfile: {
            leafyCrop: Boolean(def.leafyCrop),
            validationNote:
              def.validationStatus === 'provisional'
                ? 'Provisional polyhouse adaptation from published open-field Nigerian research; verify thresholds locally before Mode 2/3 automation.'
                : 'Verified against published FAO / NIHORT agronomic literature.'
          },
          evidenceReferences: def.evidenceReferences,
          confidenceLevel: def.confidenceLevel,
          validationStatus: def.validationStatus
        });

        const stages = buildSixStagesForSeed(def);
        for (const st of stages) {
          const existingStage = this.driver.queryOne<{ id: string }>(
            'SELECT id FROM crop_growth_stage_standards WHERE crop_profile_id = ? AND stage_name = ?',
            [profile.id, st.stageName]
          );
          const stageId = existingStage ? String(existingStage.id) : generateSecureId('cgs', 6);

          this.driver.run(
            `INSERT INTO crop_growth_stage_standards (
               id, crop_profile_id, stage_name, stage_order, day_start, day_end,
               expected_duration_days, temp_min_c, temp_max_c, temp_optimal_c,
               humidity_min_pct, humidity_optimal_pct, humidity_max_pct,
               soil_moisture_min_pct, soil_moisture_optimal_pct, soil_moisture_max_pct,
               vpd_min_kpa, vpd_max_kpa, light_dli_min, light_dli_max,
               light_hours_min, light_hours_max, ph_min, ph_max, ec_min_ms, ec_max_ms,
               irrigation_notes, nutrient_requirements_json, stress_indicators_json,
               source_organization, publication_date, validation_status, confidence_level,
               citation_refs_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(crop_profile_id, stage_name) DO UPDATE SET
               stage_order = excluded.stage_order,
               day_start = excluded.day_start,
               day_end = excluded.day_end,
               expected_duration_days = excluded.expected_duration_days,
               temp_min_c = excluded.temp_min_c,
               temp_max_c = excluded.temp_max_c,
               temp_optimal_c = excluded.temp_optimal_c,
               humidity_min_pct = excluded.humidity_min_pct,
               humidity_optimal_pct = excluded.humidity_optimal_pct,
               humidity_max_pct = excluded.humidity_max_pct,
               soil_moisture_min_pct = excluded.soil_moisture_min_pct,
               soil_moisture_optimal_pct = excluded.soil_moisture_optimal_pct,
               soil_moisture_max_pct = excluded.soil_moisture_max_pct,
               vpd_min_kpa = excluded.vpd_min_kpa,
               vpd_max_kpa = excluded.vpd_max_kpa,
               light_dli_min = excluded.light_dli_min,
               light_dli_max = excluded.light_dli_max,
               light_hours_min = excluded.light_hours_min,
               light_hours_max = excluded.light_hours_max,
               ph_min = excluded.ph_min,
               ph_max = excluded.ph_max,
               ec_min_ms = excluded.ec_min_ms,
               ec_max_ms = excluded.ec_max_ms,
               irrigation_notes = excluded.irrigation_notes,
               nutrient_requirements_json = excluded.nutrient_requirements_json,
               stress_indicators_json = excluded.stress_indicators_json,
               source_organization = excluded.source_organization,
               publication_date = excluded.publication_date,
               validation_status = excluded.validation_status,
               confidence_level = excluded.confidence_level,
               citation_refs_json = excluded.citation_refs_json`,
            [
              stageId,
              profile.id,
              st.stageName,
              st.stageOrder,
              st.dayStart,
              st.dayEnd,
              st.expectedDurationDays,
              st.tempMinC,
              st.tempMaxC,
              st.tempOptimalC,
              st.humidityMinPct,
              st.humidityOptimalPct,
              st.humidityMaxPct,
              st.soilMoistureMinPct,
              st.soilMoistureOptimalPct,
              st.soilMoistureMaxPct,
              st.vpdMinKpa,
              st.vpdMaxKpa,
              st.lightDliMin,
              st.lightDliMax,
              st.lightHoursMin,
              st.lightHoursMax,
              st.phMin,
              st.phMax,
              st.ecMinMs,
              st.ecMaxMs,
              st.irrigationNotes,
              JSON.stringify(st.nutrientRequirements),
              JSON.stringify(st.stressIndicators),
              st.sourceOrganization,
              st.publicationDate,
              st.validationStatus,
              st.confidenceLevel,
              JSON.stringify(st.citationRefs),
              nowIso
            ],
            false
          );
        }
      }
    });

    this.catalogSeeded = true;
  }

  public listAllCropProfiles(): EnrichedCropProfile[] {
    this.ensureCatalogSeeded();
    const profileRows = this.driver.queryAll<any>(
      'SELECT * FROM crop_knowledge_profiles ORDER BY crop_code ASC, variety ASC'
    );
    return profileRows.map((row) => this.hydrateProfile(row));
  }

  public resolveProfileForCrop(cropNameOrCode: string, variety?: string | null): EnrichedCropProfile {
    this.ensureCatalogSeeded();
    const raw = String(cropNameOrCode || 'tomato').trim().toLowerCase();
    const normalizedCode = raw
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    // Try exact crop_code + variety first
    if (variety && variety.trim()) {
      const exactVar = this.driver.queryOne<any>(
        'SELECT * FROM crop_knowledge_profiles WHERE crop_code = ? AND LOWER(variety) = LOWER(?) LIMIT 1',
        [normalizedCode, variety.trim()]
      );
      if (exactVar) return this.hydrateProfile(exactVar);
    }

    // Match by crop_code or substring on common_name / local_names
    const all = this.driver.queryAll<any>(
      'SELECT * FROM crop_knowledge_profiles ORDER BY validation_status DESC, created_at ASC'
    );
    const matched =
      all.find((r) => String(r.crop_code).toLowerCase() === normalizedCode) ||
      all.find((r) => raw.includes(String(r.crop_code).replace('_', ' '))) ||
      all.find((r) => String(r.common_name).toLowerCase().includes(raw)) ||
      all.find((r) => String(r.local_names_json || '').toLowerCase().includes(raw)) ||
      all.find((r) => String(r.crop_code) === 'tomato') ||
      all[0];

    return this.hydrateProfile(matched);
  }

  private hydrateProfile(row: any): EnrichedCropProfile {
    const stageRows = this.driver.queryAll<any>(
      'SELECT * FROM crop_growth_stage_standards WHERE crop_profile_id = ? ORDER BY stage_order ASC',
      [String(row.id)]
    );

    const stages: EnrichedStageStandard[] = stageRows.map((s) => ({
      id: String(s.id),
      cropProfileId: String(s.crop_profile_id),
      stageName: String(s.stage_name) as CanonicalGrowthStage,
      stageOrder: Number(s.stage_order),
      dayStart: Number(s.day_start),
      dayEnd: Number(s.day_end),
      expectedDurationDays: Number(s.expected_duration_days ?? Math.max(1, Number(s.day_end) - Number(s.day_start) + 1)),
      tempMinC: Number(s.temp_min_c),
      tempOptimalC: Number(s.temp_optimal_c ?? (Number(s.temp_min_c) + Number(s.temp_max_c)) / 2),
      tempMaxC: Number(s.temp_max_c),
      humidityMinPct: Number(s.humidity_min_pct),
      humidityOptimalPct: Number(
        s.humidity_optimal_pct ?? (Number(s.humidity_min_pct) + Number(s.humidity_max_pct)) / 2
      ),
      humidityMaxPct: Number(s.humidity_max_pct),
      soilMoistureMinPct: Number(s.soil_moisture_min_pct),
      soilMoistureOptimalPct: Number(
        s.soil_moisture_optimal_pct ??
          (Number(s.soil_moisture_min_pct) + Number(s.soil_moisture_max_pct)) / 2
      ),
      soilMoistureMaxPct: Number(s.soil_moisture_max_pct),
      phMin: Number(s.ph_min ?? 5.8),
      phMax: Number(s.ph_max ?? 6.8),
      ecMinMs: Number(s.ec_min_ms ?? 1.2),
      ecMaxMs: Number(s.ec_max_ms ?? 2.4),
      vpdMinKpa: Number(s.vpd_min_kpa ?? 0.7),
      vpdMaxKpa: Number(s.vpd_max_kpa ?? 1.3),
      lightDliMin: Number(s.light_dli_min ?? 12),
      lightDliMax: Number(s.light_dli_max ?? 22),
      lightHoursMin: Number(s.light_hours_min ?? 12),
      lightHoursMax: Number(s.light_hours_max ?? 14),
      irrigationNotes: String(s.irrigation_notes || ''),
      nutrientRequirements: safeJsonParse<NutrientRequirementSpec>(s.nutrient_requirements_json, {
        npkRatio: '2-1-2',
        nitrogenPpm: [120, 160],
        phosphorusPpm: [40, 60],
        potassiumPpm: [150, 220],
        calciumPpm: [100, 150],
        magnesiumPpm: [35, 50],
        guidance: 'Maintain balanced root-zone nutrition.'
      }),
      stressIndicators: safeJsonParse<string[]>(s.stress_indicators_json, []),
      sourceOrganization: String(s.source_organization || 'FAO / NIHORT'),
      publicationDate: String(s.publication_date || '2021'),
      validationStatus:
        String(s.validation_status) === 'provisional' ? 'provisional' : 'verified',
      confidenceLevel:
        String(s.confidence_level) === 'provisional_polyhouse_adaptation'
          ? 'provisional_polyhouse_adaptation'
          : 'verified_reference',
      citationRefs: safeJsonParse<string[]>(s.citation_refs_json, [])
    }));

    return {
      id: String(row.id),
      cropCode: String(row.crop_code),
      commonName: String(row.common_name),
      localNames: safeJsonParse<string[]>(row.local_names_json, []),
      scientificName: String(row.scientific_name),
      variety: String(row.variety),
      cultivationMethod: String(row.cultivation_method),
      standardDaysToHarvest: Number(row.standard_days_to_harvest),
      summary: String(row.summary),
      riskProfile: safeJsonParse<Record<string, unknown>>(row.risk_profile_json, {}),
      evidenceReferences: safeJsonParse(row.evidence_references_json, []),
      confidenceLevel: String(row.confidence_level),
      validationStatus: String(row.validation_status) === 'provisional' ? 'provisional' : 'verified',
      stages
    };
  }

  /**
   * Resolves the effective growth stage standard for a greenhouse/zone, merging ONLY
   * farmer-approved (`status = 'active'`) `crop_standard_versions` overrides.
   * Unapproved (`status = 'proposed'`) AI proposals NEVER alter active thresholds!
   */
  public resolveEffectiveStageStandard(params: {
    greenhouseId: string;
    zoneId?: string | null;
    cropNameOrCode: string;
    variety?: string | null;
    growthStage: string;
  }): {
    profile: EnrichedCropProfile;
    stageStandard: EnrichedStageStandard;
    activeStandardVersion: Record<string, any> | null;
    pendingProposedVersions: Record<string, any>[];
  } {
    const profile = this.resolveProfileForCrop(params.cropNameOrCode, params.variety);
    const normalizedStage = CANONICAL_GROWTH_STAGES.includes(params.growthStage as CanonicalGrowthStage)
      ? (params.growthStage as CanonicalGrowthStage)
      : 'vegetative';

    const baseStage =
      profile.stages.find((s) => s.stageName === normalizedStage) ||
      profile.stages.find((s) => s.stageName === 'vegetative') ||
      profile.stages[0];

    const versionRows = this.driver.queryAll<any>(
      `SELECT * FROM crop_standard_versions
       WHERE greenhouse_id = ?
       ORDER BY version_number DESC LIMIT 20`,
      [params.greenhouseId]
    );

    const mapVer = (r: any) => ({
      id: String(r.id),
      greenhouseId: String(r.greenhouse_id),
      zoneId: r.zone_id ? String(r.zone_id) : null,
      cropProfileId: r.crop_profile_id ? String(r.crop_profile_id) : null,
      versionNumber: Number(r.version_number),
      status: String(r.status),
      thresholds: safeJsonParse<Record<string, any>>(r.thresholds_json, {}),
      evidence: safeJsonParse<Record<string, any>>(r.evidence_json, {}),
      references: safeJsonParse<any[]>(r.references_json, []),
      proposedBy: String(r.proposed_by),
      approvedByUserId: r.approved_by_user_id ? String(r.approved_by_user_id) : null,
      createdAt: String(r.created_at),
      activatedAt: r.activated_at ? String(r.activated_at) : null
    });

    const mappedVersions = versionRows.map(mapVer);
    const activeVer =
      mappedVersions.find(
        (v) => v.status === 'active' && (!params.zoneId || !v.zoneId || v.zoneId === params.zoneId)
      ) || null;
    const pendingProposedVersions = mappedVersions.filter((v) => v.status === 'proposed');

    const effective: EnrichedStageStandard = { ...baseStage };
    if (activeVer && activeVer.thresholds) {
      const th = activeVer.thresholds;
      if (typeof th.tempMinC === 'number' && Number.isFinite(th.tempMinC)) effective.tempMinC = th.tempMinC;
      if (typeof th.tempMaxC === 'number' && Number.isFinite(th.tempMaxC)) effective.tempMaxC = th.tempMaxC;
      if (typeof th.humidityMinPct === 'number' && Number.isFinite(th.humidityMinPct)) {
        effective.humidityMinPct = th.humidityMinPct;
      }
      if (typeof th.humidityMaxPct === 'number' && Number.isFinite(th.humidityMaxPct)) {
        effective.humidityMaxPct = th.humidityMaxPct;
      }
      if (typeof th.soilMoistureMinPct === 'number' && Number.isFinite(th.soilMoistureMinPct)) {
        effective.soilMoistureMinPct = th.soilMoistureMinPct;
      }
      if (typeof th.soilMoistureMaxPct === 'number' && Number.isFinite(th.soilMoistureMaxPct)) {
        effective.soilMoistureMaxPct = th.soilMoistureMaxPct;
      }
      if (typeof th.vpdMinKpa === 'number' && Number.isFinite(th.vpdMinKpa)) effective.vpdMinKpa = th.vpdMinKpa;
      if (typeof th.vpdMaxKpa === 'number' && Number.isFinite(th.vpdMaxKpa)) effective.vpdMaxKpa = th.vpdMaxKpa;
    }

    return {
      profile,
      stageStandard: effective,
      activeStandardVersion: activeVer,
      pendingProposedVersions
    };
  }

  /**
   * Evaluates live/honest telemetry (or explicitly labeled `SIMULATED` sandbox telemetry)
   * against the active crop variety & growth stage standard, historical rollups, and
   * equipment capabilities, returning gap analysis + 8-point explainable recommendations.
   */
  public evaluateConditionsAndRecommend(params: {
    greenhouseId: string;
    zoneId?: string | null;
    cropNameOrCode: string;
    variety?: string | null;
    growthStage: string;
    telemetrySnapshot: {
      dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
      ageSeconds: number | null;
      temperature: number | null;
      humidity: number | null;
      soilMoisture: number | null;
      waterLevel: number | null;
      sunlight: number | null;
      rain: boolean | null;
      actuators?: {
        pumpActive?: boolean;
        fanActive?: boolean;
        heaterActive?: boolean;
        growLightActive?: boolean;
        roofOpen?: boolean;
      } | null;
    };
    persistRecommendations?: boolean;
  }): {
    profile: EnrichedCropProfile;
    stageStandard: EnrichedStageStandard;
    activeStandardVersion: Record<string, any> | null;
    pendingProposedVersions: Record<string, any>[];
    dataSource: 'REAL_HARDWARE' | 'STALE' | 'DISCONNECTED' | 'SIMULATED';
    computedVpdKpa: number | null;
    conditionChecks: Array<{
      metric: string;
      label: string;
      observed: number | boolean | null;
      unit: string;
      targetMin: number | null;
      targetOptimal: number | null;
      targetMax: number | null;
      status: 'within_target' | 'below_target' | 'above_target' | 'unavailable';
      note: string;
    }>;
    recommendations: EvaluatedCropRecommendation[];
  } {
    const resolved = this.resolveEffectiveStageStandard({
      greenhouseId: params.greenhouseId,
      zoneId: params.zoneId,
      cropNameOrCode: params.cropNameOrCode,
      variety: params.variety,
      growthStage: params.growthStage
    });

    const { profile, stageStandard } = resolved;
    const snap = params.telemetrySnapshot;
    const computedVpdKpa = calculateVpdKpa(snap.temperature, snap.humidity);

    // Inspect recent hourly rollups & registered equipment capabilities for context
    const hourlyRollups = this.repos.telemetryHistory.queryHourlyRollups({
      greenhouseId: params.greenhouseId,
      limit: 6
    });
    const capabilities = this.repos.zonesAndHardware.listDeviceCapabilities(params.greenhouseId);
    const safety = this.repos.authorizationAndCommands.getGreenhouseSafetyEnvelope(params.greenhouseId);

    const hasActuatorCap = (key: string): boolean => {
      if (capabilities.length === 0) return true; // Default standard kit relays supported in simulation
      return capabilities.some(
        (c) => c.capabilityKind === 'actuator' && c.isEnabled && c.channelKey.toLowerCase().includes(key)
      );
    };

    const classifyMetric = (
      val: number | null,
      minV: number,
      optV: number,
      maxV: number,
      label: string,
      unit: string
    ) => {
      if (val === null || !Number.isFinite(val)) {
        return {
          metric: label.toLowerCase().replace(/\s+/g, '_'),
          label,
          observed: null,
          unit,
          targetMin: minV,
          targetOptimal: optV,
          targetMax: maxV,
          status: 'unavailable' as const,
          note: `No ${label.toLowerCase()} reading reported (${snap.dataSource}).`
        };
      }
      if (val < minV) {
        return {
          metric: label.toLowerCase().replace(/\s+/g, '_'),
          label,
          observed: val,
          unit,
          targetMin: minV,
          targetOptimal: optV,
          targetMax: maxV,
          status: 'below_target' as const,
          note: `${(minV - val).toFixed(1)}${unit} below ${stageStandard.stageName} minimum (${minV}${unit}).`
        };
      }
      if (val > maxV) {
        return {
          metric: label.toLowerCase().replace(/\s+/g, '_'),
          label,
          observed: val,
          unit,
          targetMin: minV,
          targetOptimal: optV,
          targetMax: maxV,
          status: 'above_target' as const,
          note: `${(val - maxV).toFixed(1)}${unit} above ${stageStandard.stageName} maximum (${maxV}${unit}).`
        };
      }
      return {
        metric: label.toLowerCase().replace(/\s+/g, '_'),
        label,
        observed: val,
        unit,
        targetMin: minV,
        targetOptimal: optV,
        targetMax: maxV,
        status: 'within_target' as const,
        note: `Within ${stageStandard.stageName} target band (${minV}–${maxV}${unit}).`
      };
    };

    const conditionChecks = [
      classifyMetric(
        snap.temperature,
        stageStandard.tempMinC,
        stageStandard.tempOptimalC,
        stageStandard.tempMaxC,
        'Canopy Temperature',
        '°C'
      ),
      classifyMetric(
        snap.humidity,
        stageStandard.humidityMinPct,
        stageStandard.humidityOptimalPct,
        stageStandard.humidityMaxPct,
        'Relative Humidity',
        '%'
      ),
      classifyMetric(
        snap.soilMoisture,
        stageStandard.soilMoistureMinPct,
        stageStandard.soilMoistureOptimalPct,
        stageStandard.soilMoistureMaxPct,
        'Root-Zone Moisture',
        '%'
      ),
      classifyMetric(
        computedVpdKpa,
        stageStandard.vpdMinKpa,
        Math.round(((stageStandard.vpdMinKpa + stageStandard.vpdMaxKpa) / 2) * 100) / 100,
        stageStandard.vpdMaxKpa,
        'Vapor Pressure Deficit (VPD)',
        ' kPa'
      )
    ];

    const recommendations: EvaluatedCropRecommendation[] = [];

    // Confidence scoring strictly reflects data freshness & reference validation status
    const buildConfidenceBlock = (
      baseScore: number
    ): EightPointRecommendationExplanation['systemConfidence'] => {
      const refPenalty = stageStandard.validationStatus === 'provisional' ? 0.08 : 0;
      if (snap.dataSource === 'SIMULATED') {
        const sc = Math.max(0.5, Math.min(0.92, baseScore - refPenalty));
        return {
          score: Math.round(sc * 100) / 100,
          label: 'Simulation Sandbox',
          dataSource: 'SIMULATED',
          calibrationBasis: `Evaluated on explicit SIMULATED test inputs against ${stageStandard.validationStatus} ${stageStandard.sourceOrganization} (${stageStandard.publicationDate}) ${profile.commonName} [${stageStandard.stageName}] standard.`
        };
      }
      if (snap.dataSource !== 'REAL_HARDWARE') {
        return {
          score: 0.35,
          label: 'Low — Stale/Unverified Data',
          dataSource: snap.dataSource,
          calibrationBasis: `Sensor telemetry is ${snap.dataSource} (age=${snap.ageSeconds ?? 'unknown'}s). Physical or automated execution is locked until fresh REAL_HARDWARE readings (<45s) resume.`
        };
      }
      const sc = Math.max(0.55, Math.min(0.96, baseScore - refPenalty));
      return {
        score: Math.round(sc * 100) / 100,
        label: sc >= 0.8 ? 'High' : 'Moderate',
        dataSource: 'REAL_HARDWARE',
        calibrationBasis: `Fresh REAL_HARDWARE telemetry (${snap.ageSeconds ?? 0}s old) + ${hourlyRollups.length}h rollup history matched against ${stageStandard.validationStatus} ${stageStandard.sourceOrganization} (${stageStandard.publicationDate}) standard.`
      };
    };

    // 1. Rain Intrusion Protection Check
    if (snap.rain === true && snap.actuators?.roofOpen !== false) {
      const conf = buildConfidenceBlock(0.95);
      recommendations.push({
        agentName: 'Structural Weather & Safety Agent',
        category: 'RAIN_ROOF_PROTECTION',
        riskLevel: 'high',
        confidenceScore: conf.score,
        dataSource: snap.dataSource,
        cropCode: profile.cropCode,
        cropVariety: profile.variety,
        growthStage: stageStandard.stageName,
        observationSummary: `Active rainfall detected while roof vent is not confirmed closed for ${profile.commonName} (${stageStandard.stageName}).`,
        proposedAction: {
          targetEquipment: 'roof_vent',
          commandType: 'CLOSE_ROOF_VENT',
          desiredState: 'closed',
          durationSeconds: 15,
          actuatableInSimulation: hasActuatorCap('roof')
        },
        expectedOutcome: {
          metric: 'roofOpen',
          expectedDelta: -1,
          unit: 'state',
          verificationWindowSeconds: 60
        },
        evidence: {
          rainDetected: true,
          roofOpen: snap.actuators?.roofOpen ?? null,
          humidityPct: snap.humidity,
          cropStage: stageStandard.stageName
        },
        explanation: {
          whatIsHappening: `Rainfall is hitting the greenhouse rain sensor while the motorized roof vent is open or unlocked during ${profile.commonName} (${profile.variety}) ${stageStandard.stageName} stage.`,
          supportingEvidence: `Rain sensor = TRUE; Roof open state = ${String(snap.actuators?.roofOpen ?? 'unconfirmed')}; Canopy RH = ${snap.humidity ?? 'N/A'}% (data source: ${snap.dataSource}).`,
          recommendedAction: `Close and lock the motorized roof vent immediately until rainfall stops, using side circulation fans if internal temperature exceeds ${stageStandard.tempMaxC}°C.`,
          whyRecommended: `Direct rain splash onto ${profile.commonName} foliage during ${stageStandard.stageName} spreads bacterial spot, early blight, and root-zone waterlogging.`,
          consequenceOfInaction: `Canopy leaf wetness, rapid fungal/oomycete spore germination, nutrient leaching from beds, and potential electrical moisture damage.`,
          possibleRisks: `Closing the roof vent during warm rain can briefly raise internal heat and humidity; internal horizontal fans mitigate stagnant air pockets.`,
          systemConfidence: conf,
          verificationPlan: {
            targetMetric: 'roofOpen',
            baselineValue: snap.actuators?.roofOpen ?? true,
            expectedDirection: 'close_lock',
            expectedDeltaRange: 'roofOpen -> false with rainRoofLocked=true',
            verificationWindowSeconds: 60,
            successCriteria: 'Controller acknowledges roofOpen=false within 60 seconds and soil moisture does not spike uncontrollably.'
          }
        }
      });
    }

    // 2. Root-Zone Moisture Deficit Check (Irrigation Pulse)
    if (snap.soilMoisture !== null && snap.soilMoisture < stageStandard.soilMoistureMinPct) {
      const deficit = stageStandard.soilMoistureMinPct - snap.soilMoisture;
      const pulseSec = Math.min(
        safety.policyDefaults.maxIndividualIrrigationPulseSeconds,
        Math.max(15, Math.round(deficit * 2.5))
      );
      const lowWaterWarning =
        snap.waterLevel !== null && snap.waterLevel < safety.policyDefaults.waterLevelIrrigationLockPct;
      const conf = buildConfidenceBlock(0.9);

      recommendations.push({
        agentName: 'Root-Zone Irrigation Agronomist',
        category: 'IRRIGATION_PULSE',
        riskLevel: deficit >= 12 || stageStandard.stageName === 'flowering' || stageStandard.stageName === 'fruiting' ? 'high' : 'medium',
        confidenceScore: conf.score,
        dataSource: snap.dataSource,
        cropCode: profile.cropCode,
        cropVariety: profile.variety,
        growthStage: stageStandard.stageName,
        observationSummary: `Root-zone soil moisture (${snap.soilMoisture.toFixed(1)}%) is ${deficit.toFixed(1)}% below the ${profile.commonName} (${profile.variety}) ${stageStandard.stageName} minimum (${stageStandard.soilMoistureMinPct}%).`,
        proposedAction: {
          targetEquipment: 'pump',
          commandType: 'IRRIGATION_PULSE',
          desiredState: 'on',
          durationSeconds: pulseSec,
          actuatableInSimulation: hasActuatorCap('pump') || hasActuatorCap('drip')
        },
        expectedOutcome: {
          metric: 'soilMoisture',
          expectedDelta: Math.round(pulseSec * 0.22 * 10) / 10,
          unit: '%',
          verificationWindowSeconds: 600
        },
        evidence: {
          soilMoisturePct: snap.soilMoisture,
          targetMinPct: stageStandard.soilMoistureMinPct,
          targetOptimalPct: stageStandard.soilMoistureOptimalPct,
          waterLevelPct: snap.waterLevel,
          vpdKpa: computedVpdKpa,
          standardSource: `${stageStandard.sourceOrganization} (${stageStandard.publicationDate})`
        },
        explanation: {
          whatIsHappening: `Root-zone moisture for ${profile.commonName} (${profile.variety}) in ${stageStandard.stageName} stage has dropped to ${snap.soilMoisture.toFixed(1)}%, below the minimum threshold of ${stageStandard.soilMoistureMinPct}% (optimal ${stageStandard.soilMoistureOptimalPct}%).`,
          supportingEvidence: `Measured soil moisture = ${snap.soilMoisture.toFixed(1)}%; VPD = ${computedVpdKpa ?? 'N/A'} kPa; Tank water level = ${snap.waterLevel !== null ? `${snap.waterLevel.toFixed(1)}%` : 'UNREPORTED'}; Standard = ${stageStandard.sourceOrganization} (${stageStandard.publicationDate}, ${stageStandard.validationStatus}).`,
          recommendedAction: lowWaterWarning
            ? `Refill irrigation reservoir first (tank at ${snap.waterLevel?.toFixed(1)}%, below ${safety.policyDefaults.waterLevelIrrigationLockPct}% safety lock), then deliver a bounded ${pulseSec}-second drip irrigation pulse.`
            : `Deliver a bounded ${pulseSec}-second drip irrigation pulse, followed by a mandatory ${safety.policyDefaults.minPumpCooldownSeconds}-second soak cooldown before re-evaluating.`,
          whyRecommended: `${stageStandard.irrigationNotes} Short bounded pulses re-wet the active rhizosphere without flushing soluble ${stageStandard.nutrientRequirements.npkRatio} nutrients or starving roots of oxygen.`,
          consequenceOfInaction: `Stomatal closure, reduced photosynthesis, calcium transport lock-out (${stageStandard.stressIndicators[0] || 'moisture stress'}), and flower/fruit abortion if deficit persists.`,
          possibleRisks: lowWaterWarning
            ? `Pump dry-run damage if activated while reservoir is below ${safety.policyDefaults.waterLevelIrrigationLockPct}% (blocked automatically by Two-Tier Safety).`
            : `Over-irrigation or fruit cracking if sensor is dislodged from root ball; mitigated by capping pulse to ${pulseSec}s (Tier 1 ceiling ${safety.hardwareProtection.maxContinuousPumpSeconds}s) and verifying soak response.`,
          systemConfidence: conf,
          verificationPlan: {
            targetMetric: 'soilMoisture',
            baselineValue: snap.soilMoisture,
            expectedDirection: 'increase',
            expectedDeltaRange: `+3.0% to +8.0% toward ${stageStandard.soilMoistureOptimalPct}%`,
            verificationWindowSeconds: 600,
            successCriteria: `Root-zone soil moisture increases by >= 2.5% within 10 minutes without exceeding ${stageStandard.soilMoistureMaxPct}%.`
          }
        }
      });
    }

    // 3. Heat Stress / High VPD Check (Ventilation Cooling)
    if (
      (snap.temperature !== null && snap.temperature > stageStandard.tempMaxC) ||
      (computedVpdKpa !== null && computedVpdKpa > stageStandard.vpdMaxKpa + 0.15)
    ) {
      const tempExcess = snap.temperature !== null ? snap.temperature - stageStandard.tempMaxC : 0;
      const conf = buildConfidenceBlock(0.89);
      recommendations.push({
        agentName: 'Microclimate & Transpiration Agent',
        category: 'VENTILATION_COOLING',
        riskLevel: tempExcess >= 3.5 ? 'high' : 'medium',
        confidenceScore: conf.score,
        dataSource: snap.dataSource,
        cropCode: profile.cropCode,
        cropVariety: profile.variety,
        growthStage: stageStandard.stageName,
        observationSummary: `Canopy temperature (${snap.temperature ?? 'N/A'}°C) / VPD (${computedVpdKpa ?? 'N/A'} kPa) exceeds ${profile.commonName} ${stageStandard.stageName} ceiling (${stageStandard.tempMaxC}°C / ${stageStandard.vpdMaxKpa} kPa).`,
        proposedAction: {
          targetEquipment: 'fan',
          commandType: 'VENTILATION_PULSE',
          desiredState: 'on',
          durationSeconds: 180,
          actuatableInSimulation: hasActuatorCap('fan')
        },
        expectedOutcome: {
          metric: 'temperature',
          expectedDelta: -1.6,
          unit: '°C',
          verificationWindowSeconds: 600
        },
        evidence: {
          temperatureC: snap.temperature,
          tempMaxC: stageStandard.tempMaxC,
          humidityPct: snap.humidity,
          vpdKpa: computedVpdKpa,
          vpdMaxKpa: stageStandard.vpdMaxKpa,
          hourlyAvgTempC: hourlyRollups[0]?.tempAvg ?? null
        },
        explanation: {
          whatIsHappening: `Canopy heat load (${snap.temperature ?? 'N/A'}°C) and/or atmospheric evaporative demand (VPD ${computedVpdKpa ?? 'N/A'} kPa) has risen above the safe ${stageStandard.stageName} upper bound (${stageStandard.tempMaxC}°C, VPD <= ${stageStandard.vpdMaxKpa} kPa) for ${profile.commonName} (${profile.variety}).`,
          supportingEvidence: `Observed Temp = ${snap.temperature ?? 'N/A'}°C (target ${stageStandard.tempMinC}–${stageStandard.tempMaxC}°C); RH = ${snap.humidity ?? 'N/A'}%; Computed Magnus-Tetens VPD = ${computedVpdKpa ?? 'N/A'} kPa; Recent 1h avg temp = ${hourlyRollups[0]?.tempAvg?.toFixed?.(1) ?? 'N/A'}°C.`,
          recommendedAction: `Run exhaust/circulation ventilation fans for a 180-second air-exchange cycle${snap.rain === true ? ' (keep roof vent closed due to rain)' : ''}.`,
          whyRecommended: `Active air exchange exhausts solar heat trapped under polyhouse glazing, restoring leaf boundary-layer conductance and keeping pollen/stomata functional.`,
          consequenceOfInaction: `Heat-induced stomatal shutdown, ${stageStandard.stressIndicators[0] || 'blossom drop and leaf curl'}, and accelerated root-zone moisture depletion.`,
          possibleRisks: `If ambient outside air is hotter and drier (Harmattan afternoon), excessive exhausting without adequate root moisture can further elevate VPD; monitor VPD response after 10 minutes.`,
          systemConfidence: conf,
          verificationPlan: {
            targetMetric: 'temperature',
            baselineValue: snap.temperature,
            expectedDirection: 'decrease',
            expectedDeltaRange: `-1.0°C to -2.5°C toward ${stageStandard.tempOptimalC}°C`,
            verificationWindowSeconds: 600,
            successCriteria: `Canopy temperature drops by >= 0.8°C or stabilizes at/below ${stageStandard.tempMaxC}°C within 10 minutes.`
          }
        }
      });
    }

    // 4. Excess Humidity / Fungal Risk Check (Dehumidifying Air Circulation)
    if (
      snap.humidity !== null &&
      snap.humidity > stageStandard.humidityMaxPct &&
      (snap.temperature === null || snap.temperature <= stageStandard.tempMaxC)
    ) {
      const rhExcess = snap.humidity - stageStandard.humidityMaxPct;
      const conf = buildConfidenceBlock(0.87);
      recommendations.push({
        agentName: 'Phytopathology & Airflow Agent',
        category: 'HUMIDITY_VENTING',
        riskLevel: rhExcess >= 10 ? 'high' : 'medium',
        confidenceScore: conf.score,
        dataSource: snap.dataSource,
        cropCode: profile.cropCode,
        cropVariety: profile.variety,
        growthStage: stageStandard.stageName,
        observationSummary: `Canopy relative humidity (${snap.humidity.toFixed(1)}%) exceeds ${profile.commonName} ${stageStandard.stageName} maximum (${stageStandard.humidityMaxPct}%), elevating fungal condensation risk.`,
        proposedAction: {
          targetEquipment: 'fan',
          commandType: 'HUMIDITY_PURGE_FAN',
          desiredState: 'on',
          durationSeconds: 150,
          actuatableInSimulation: hasActuatorCap('fan')
        },
        expectedOutcome: {
          metric: 'humidity',
          expectedDelta: -5.5,
          unit: '%',
          verificationWindowSeconds: 600
        },
        evidence: {
          humidityPct: snap.humidity,
          humidityMaxPct: stageStandard.humidityMaxPct,
          vpdKpa: computedVpdKpa,
          vpdMinKpa: stageStandard.vpdMinKpa
        },
        explanation: {
          whatIsHappening: `Canopy relative humidity (${snap.humidity.toFixed(1)}%) is ${rhExcess.toFixed(1)}% above the ${stageStandard.stageName} ceiling (${stageStandard.humidityMaxPct}%), suppressing transpiration (VPD ${computedVpdKpa ?? 'N/A'} kPa).`,
          supportingEvidence: `Observed RH = ${snap.humidity.toFixed(1)}% (target ${stageStandard.humidityMinPct}–${stageStandard.humidityMaxPct}%); VPD = ${computedVpdKpa ?? 'N/A'} kPa (minimum target ${stageStandard.vpdMinKpa} kPa).`,
          recommendedAction: `Activate canopy circulation/exhaust fans for 150 seconds to break leaf boundary moisture films.`,
          whyRecommended: `High humidity prevents leaf transpiration needed for calcium transport and creates free-water films required by Botrytis, Alternaria, and downy mildew spores.`,
          consequenceOfInaction: `Fungal lesion outbreak, clumped non-viable pollen during flowering, and calcium-deficiency tipburn / blossom-end rot.`,
          possibleRisks: `Minimal risk; avoid chilling seedlings if night ambient temperature is below ${stageStandard.tempMinC}°C.`,
          systemConfidence: conf,
          verificationPlan: {
            targetMetric: 'humidity',
            baselineValue: snap.humidity,
            expectedDirection: 'decrease',
            expectedDeltaRange: `-3.0% to -8.0% toward ${stageStandard.humidityOptimalPct}%`,
            verificationWindowSeconds: 600,
            successCriteria: `Relative humidity decreases by >= 2.5% and VPD rises toward >= ${stageStandard.vpdMinKpa} kPa within 10 minutes.`
          }
        }
      });
    }

    // 5. Cold Stress Check (Bounded Supplemental Heating)
    if (
      snap.temperature !== null &&
      snap.temperature < stageStandard.tempMinC &&
      snap.temperature < safety.policyDefaults.heaterOperatingLockTempC
    ) {
      const coldGap = stageStandard.tempMinC - snap.temperature;
      const conf = buildConfidenceBlock(0.86);
      recommendations.push({
        agentName: 'Night Thermal Protection Agent',
        category: 'SUPPLEMENTAL_HEATING',
        riskLevel: coldGap >= 3 ? 'high' : 'medium',
        confidenceScore: conf.score,
        dataSource: snap.dataSource,
        cropCode: profile.cropCode,
        cropVariety: profile.variety,
        growthStage: stageStandard.stageName,
        observationSummary: `Canopy temperature (${snap.temperature.toFixed(1)}°C) fell below ${profile.commonName} ${stageStandard.stageName} minimum (${stageStandard.tempMinC}°C).`,
        proposedAction: {
          targetEquipment: 'heater',
          commandType: 'BOUNDED_HEAT_PULSE',
          desiredState: 'on',
          durationSeconds: 120,
          actuatableInSimulation: hasActuatorCap('heater')
        },
        expectedOutcome: {
          metric: 'temperature',
          expectedDelta: 1.5,
          unit: '°C',
          verificationWindowSeconds: 600
        },
        evidence: {
          temperatureC: snap.temperature,
          tempMinC: stageStandard.tempMinC,
          heaterOperatingLockTempC: safety.policyDefaults.heaterOperatingLockTempC,
          heaterHardwareCeilingC: safety.hardwareProtection.heaterAbsoluteLockTempC
        },
        explanation: {
          whatIsHappening: `Greenhouse air temperature (${snap.temperature.toFixed(1)}°C) is ${coldGap.toFixed(1)}°C below the ${stageStandard.stageName} minimum (${stageStandard.tempMinC}°C) for ${profile.commonName} (${profile.variety}).`,
          supportingEvidence: `Observed Temp = ${snap.temperature.toFixed(1)}°C; Stage Min = ${stageStandard.tempMinC}°C; Tier-2 Heater Cutoff = ${safety.policyDefaults.heaterOperatingLockTempC}°C; Tier-1 Hardware Cutoff = ${safety.hardwareProtection.heaterAbsoluteLockTempC}°C.`,
          recommendedAction: `Run a bounded 120-second supplemental heater cycle while keeping roof vents closed to retain thermal mass.`,
          whyRecommended: `Sub-minimum root and canopy temperatures stall enzymatic nutrient uptake (especially phosphorus) and cause flower malformation in warm-season crops.`,
          consequenceOfInaction: `Stunted growth, purpling foliage from phosphorus lock-out, and chilled cat-faced fruit.`,
          possibleRisks: `Localized dry heat near heater outlet; strictly bounded by Tier-2 (${safety.policyDefaults.heaterOperatingLockTempC}°C) and Tier-1 (${safety.hardwareProtection.heaterAbsoluteLockTempC}°C) thermal cutoffs.`,
          systemConfidence: conf,
          verificationPlan: {
            targetMetric: 'temperature',
            baselineValue: snap.temperature,
            expectedDirection: 'increase',
            expectedDeltaRange: `+1.0°C to +2.2°C above ${stageStandard.tempMinC}°C`,
            verificationWindowSeconds: 600,
            successCriteria: `Canopy temperature rises above ${stageStandard.tempMinC}°C without exceeding ${safety.policyDefaults.heaterOperatingLockTempC}°C.`
          }
        }
      });
    }

    // Persist recommendations if requested so farmer can approve/reject/modify them
    if (params.persistRecommendations && recommendations.length > 0) {
      const nowIso = new Date().toISOString();
      this.driver.runInTransaction(() => {
        for (const rec of recommendations) {
          // Deduplicate against an identical pending recommendation in the last 30 minutes
          const existingPending = this.driver.queryOne<{ id: string }>(
            `SELECT id FROM ai_recommendations
             WHERE greenhouse_id = ? AND category = ? AND status = 'pending' AND growth_stage = ?
             ORDER BY created_at DESC LIMIT 1`,
            [params.greenhouseId, rec.category, rec.growthStage]
          );
          if (existingPending) {
            rec.id = String(existingPending.id);
            this.driver.run(
              `UPDATE ai_recommendations
               SET observation_summary = ?, evidence_json = ?, confidence_score = ?, risk_level = ?,
                   proposed_action_json = ?, expected_outcome_json = ?, data_source = ?,
                   explanation_json = ?, created_at = ?
               WHERE id = ?`,
              [
                redactSecretsFromText(rec.observationSummary),
                JSON.stringify(rec.evidence),
                rec.confidenceScore,
                rec.riskLevel,
                JSON.stringify(rec.proposedAction),
                JSON.stringify(rec.expectedOutcome),
                rec.dataSource,
                JSON.stringify(rec.explanation),
                nowIso,
                rec.id
              ],
              false
            );
          } else {
            const id = generateSecureId('rec', 8);
            rec.id = id;
            this.driver.run(
              `INSERT INTO ai_recommendations (
                 id, greenhouse_id, zone_id, agent_name, category, observation_summary,
                 evidence_json, confidence_score, risk_level, proposed_action_json,
                 expected_outcome_json, fallback_plan, requires_farmer_approval, status,
                 crop_code, crop_variety, growth_stage, data_source, explanation_json,
                 execution_mode, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?, ?, ?, 'SIMULATION_ONLY', ?)`,
              [
                id,
                params.greenhouseId,
                params.zoneId || null,
                rec.agentName,
                rec.category,
                redactSecretsFromText(rec.observationSummary),
                JSON.stringify(rec.evidence),
                rec.confidenceScore,
                rec.riskLevel,
                JSON.stringify(rec.proposedAction),
                JSON.stringify(rec.expectedOutcome),
                'Hold equipment OFF and alert farmer if telemetry becomes stale (>45s) or safety interlock triggers.',
                rec.cropCode,
                rec.cropVariety,
                rec.growthStage,
                rec.dataSource,
                JSON.stringify(rec.explanation),
                nowIso
              ],
              false
            );
          }
        }
      });
    }

    return {
      profile,
      stageStandard,
      activeStandardVersion: resolved.activeStandardVersion,
      pendingProposedVersions: resolved.pendingProposedVersions,
      dataSource: snap.dataSource,
      computedVpdKpa,
      conditionChecks,
      recommendations
    };
  }
}
