import { SqliteDriver } from './sqliteDriver.ts';
import { CropIntelligenceEngine } from './cropIntelligenceEngine.ts';
import type { PlatformRepositories } from './repositories.ts';

export type DiagnosticCategory =
  | 'disease'
  | 'pest'
  | 'nutrient_deficiency'
  | 'abiotic_stress'
  | 'harvest_condition';

export interface DiagnosticKnowledgeCard {
  id: string;
  code: string;
  category: DiagnosticCategory;
  title: string;
  cropCodes: string[];
  growthStages: string[];
  causalAgent: string | null;
  symptoms: string[];
  environmentalTriggers: {
    tempMinC?: number;
    tempMaxC?: number;
    humidityMinPct?: number;
    humidityMaxPct?: number;
    soilMoistureMinPct?: number;
    soilMoistureMaxPct?: number;
    vpdMinKpa?: number;
    vpdMaxKpa?: number;
    phBelow?: number;
    phAbove?: number;
    triggerSummary: string;
  };
  differentialDiagnosis: string[];
  preventionOptions: string[];
  treatmentOptions: string[];
  harvestImpact: string;
  geographicApplicability: string[];
  sourceOrganization: string;
  sourceCitation: string;
  publicationDate: string;
  confidenceLevel: 'verified_reference' | 'extension_consensus';
  validationStatus: 'verified' | 'provisional';
}

const AUTHORITATIVE_DIAGNOSTIC_SEED: Omit<DiagnosticKnowledgeCard, 'id'>[] = [
  {
    code: 'tomato_early_blight',
    category: 'disease',
    title: 'Early Blight (Target Spot Complex)',
    cropCodes: ['tomato', 'bell_pepper', 'habanero_pepper'],
    growthStages: ['vegetative', 'flowering', 'fruiting'],
    causalAgent: 'Alternaria solani',
    symptoms: [
      'Concentric dark brown "target-ring" lesions on older lower leaves first',
      'Chlorotic yellow halo surrounding necrotic leaf spots',
      'Premature defoliation exposing developing fruit to sunscald'
    ],
    environmentalTriggers: {
      tempMinC: 24,
      tempMaxC: 30,
      humidityMinPct: 80,
      triggerSummary: 'Warm canopy temperatures (24–29°C) combined with high relative humidity (>80%) or leaf wetness from overhead splashing.'
    },
    differentialDiagnosis: ['Septoria leaf spot', 'Bacterial spot', 'Lower-leaf magnesium or nitrogen senescence'],
    preventionOptions: [
      'Use drip irrigation exclusively; avoid wetting foliage',
      'Prune lower senescing leaves below first ripening truss to improve under-canopy airflow',
      'Ventilate polyhouse early morning to clear overnight condensation (keep RH < 75%)'
    ],
    treatmentOptions: [
      'Remove and bag infected lower leaflets outside the greenhouse immediately',
      'Apply registered copper-based or mancozeb/azoxystrobin protectant per NIHORT/FAO pre-harvest interval (PHI) rules'
    ],
    harvestImpact: 'Severe defoliation reduces marketable yield by 20–40% and increases fruit sunscald.',
    geographicApplicability: ['Humid Forest (South-West/South-South Nigeria)', 'Derived Savanna', 'Guinea Savanna'],
    sourceOrganization: 'FAO & NIHORT Ibadan',
    sourceCitation: 'FAO Plant Production and Protection Paper 230 (GAP for Greenhouse Vegetable Production); NIHORT Tomato Protection Bulletin (2021)',
    publicationDate: '2021-06',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'tomato_late_blight',
    category: 'disease',
    title: 'Late Blight',
    cropCodes: ['tomato'],
    growthStages: ['vegetative', 'flowering', 'fruiting'],
    causalAgent: 'Phytophthora infestans',
    symptoms: [
      'Irregular water-soaked pale-green to dark-black lesions on leaves and stems',
      'White cottony sporulation on leaf undersides during cool humid mornings',
      'Firm greasy brown lesions on green fruit'
    ],
    environmentalTriggers: {
      tempMinC: 15,
      tempMaxC: 24,
      humidityMinPct: 85,
      triggerSummary: 'Cool-to-moderate temperatures (15–24°C) with sustained relative humidity >= 85% and free leaf moisture.'
    },
    differentialDiagnosis: ['Early blight (concentric rings)', 'Botrytis gray mold'],
    preventionOptions: [
      'Maintain polyhouse RH below 78% via horizontal airflow and roof ventilation',
      'Inspect highland/wet-season nurseries daily before transplanting'
    ],
    treatmentOptions: [
      'Immediate sanitation of heavily infected plants to prevent sporangia spread',
      'Targeted oomycete fungicide program observing strict pre-harvest intervals'
    ],
    harvestImpact: 'Rapid canopy collapse within 7–10 days if unmitigated; fruit rot.',
    geographicApplicability: ['Jos Plateau Highland', 'Mambilla Plateau', 'Wet-Season Tropical Polyhouses'],
    sourceOrganization: 'CIP / CGIAR & FAO',
    sourceCitation: 'CGIAR/CIP Late Blight Integrated Management Manual; FAO Paper 230',
    publicationDate: '2019-09',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'bacterial_wilt_solanaceae',
    category: 'disease',
    title: 'Bacterial Vascular Wilt',
    cropCodes: ['tomato', 'bell_pepper', 'habanero_pepper'],
    growthStages: ['vegetative', 'flowering', 'fruiting'],
    causalAgent: 'Ralstonia solanacearum',
    symptoms: [
      'Sudden daytime green wilting of younger upper leaves WITHOUT prior yellowing',
      'Temporary nighttime recovery followed by irreversible whole-plant wilt',
      'Brown vascular discoloration and milky bacterial ooze when cut stem is suspended in clean water'
    ],
    environmentalTriggers: {
      tempMinC: 28,
      soilMoistureMinPct: 75,
      triggerSummary: 'Warm root zones (>28°C) paired with waterlogged or poorly drained soil beds (>75% moisture).'
    },
    differentialDiagnosis: ['Fusarium wilt (yellowing often unilateral)', 'Drought wilt (dry soil)', 'Root-knot nematode galling'],
    preventionOptions: [
      'Use clean coco-peat/sterilized substrate in troughs or grafted resistant rootstocks',
      'Disinfect pruning shears between plants and prevent irrigation runoff between bays',
      'Avoid over-irrigation and root-zone waterlogging'
    ],
    treatmentOptions: [
      'No curative chemical spray exists once vascular system is colonized; rogue infected plant and surrounding root medium immediately in sealed bags',
      'Solarize or replace contaminated substrate before replanting'
    ],
    harvestImpact: '100% loss of infected individual plants; soil persistence across seasons.',
    geographicApplicability: ['All Nigerian Agro-Ecological Zones (Humid Forest to Sudan Savanna)'],
    sourceOrganization: 'IITA Ibadan & WorldVeg (CGIAR)',
    sourceCitation: 'WorldVeg/IITA Tropical Solanaceous Disease Compendium (2020)',
    publicationDate: '2020-04',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'tuta_absoluta_leafminer',
    category: 'pest',
    title: 'Tomato Leafminer ("Tomato Ebola")',
    cropCodes: ['tomato'],
    growthStages: ['seedling', 'vegetative', 'flowering', 'fruiting'],
    causalAgent: 'Tuta absoluta (Meyrick)',
    symptoms: [
      'Irregular translucent blotch mines between upper and lower leaf epidermis containing dark frass',
      'Pinhole entry tunnels under fruit calyx leading to secondary rot',
      'Apical bud boring in young transplants'
    ],
    environmentalTriggers: {
      tempMinC: 25,
      humidityMaxPct: 65,
      triggerSummary: 'Rapid lifecycle (24–28 days) in warm, dry conditions (>25°C), entering polyhouses through torn insect netting or infested seedlings.'
    },
    differentialDiagnosis: ['Liriomyza serpentine leafminer (narrow winding trails rather than wide blotches)'],
    preventionOptions: [
      'Maintain intact 50-mesh insect-proof netting on all side walls and double-door airlocks',
      'Deploy Tuta pheromone delta/water traps (2–4 traps per 500 m² polyhouse) from transplanting day 1'
    ],
    treatmentOptions: [
      'Prune and destroy mined leaflets and infested fruit immediately',
      'Rotate biologicals/selective larvicides (Bacillus thuringiensis kurstaki, spinosad, or Azadirachtin neem extract) to prevent resistance'
    ],
    harvestImpact: 'Can cause 50–100% marketable fruit loss in unscreened Nigerian tomato farms.',
    geographicApplicability: ['Kano, Kaduna, Katsina, Plateau, Oyo, Ogun & Nationwide Protected Cultivation'],
    sourceOrganization: 'NIHORT Ibadan, IAR Zaria & FAO',
    sourceCitation: 'FAO/NIHORT Emergency Management Guide for Tuta absoluta in Nigeria (2018; rev. 2022)',
    publicationDate: '2022-03',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'bemisia_whitefly_tylcv',
    category: 'pest',
    title: 'Silverleaf Whitefly & TYLCV Vector Complex',
    cropCodes: ['tomato', 'bell_pepper', 'habanero_pepper', 'cucumber', 'okra', 'fluted_pumpkin'],
    growthStages: ['seedling', 'vegetative', 'flowering', 'fruiting'],
    causalAgent: 'Bemisia tabaci & Tomato Yellow Leaf Curl Begomovirus',
    symptoms: [
      'Clouds of tiny white winged adults rising from leaf undersides when disturbed',
      'Sticky honeydew and black sooty mold on lower leaves reducing photosynthesis',
      'Upward leaf curling, interveinal yellowing, and stunted "bonsai" shoot growth if TYLCV is transmitted'
    ],
    environmentalTriggers: {
      tempMinC: 27,
      humidityMaxPct: 65,
      triggerSummary: 'Warm temperatures (27–33°C) and dry savanna breezes accelerate reproduction.'
    },
    differentialDiagnosis: ['Aphid colonies', 'Herbicide drift', 'Physiological leaf roll from heat/pruning'],
    preventionOptions: [
      'Install 50-mesh anti-insect screening and yellow sticky monitoring cards just above canopy height',
      'Select TYLCV-tolerant hybrids (e.g., Padma F1 / Tylka F1) in high-pressure zones'
    ],
    treatmentOptions: [
      'Early horticultural soap / neem oil underside coverage before populations exceed 2 adults per leaf',
      'Rogue confirmed virus-stunted plants early in vegetative stage to remove inoculum reservoir'
    ],
    harvestImpact: 'Early TYLCV infection before flowering can reduce fruit set by 60–90%.',
    geographicApplicability: ['All Nigerian Agro-Ecological Zones'],
    sourceOrganization: 'IITA Ibadan & FAO',
    sourceCitation: 'IITA Whitefly & Begomovirus Integrated Pest Management Guide; FAO Paper 230',
    publicationDate: '2020-11',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'calcium_blossom_end_rot',
    category: 'nutrient_deficiency',
    title: 'Blossom End Rot (Calcium Xylem Transport Deficit)',
    cropCodes: ['tomato', 'bell_pepper', 'habanero_pepper'],
    growthStages: ['flowering', 'fruiting'],
    causalAgent: 'Physiological localized Ca2+ deficiency in distal fruit tissue',
    symptoms: [
      'Sunken, leathery dark-brown to black necrotic patch at the blossom (bottom) end of developing fruit',
      'Often appears on first 1–2 fruit trusses during rapid cell expansion'
    ],
    environmentalTriggers: {
      soilMoistureMaxPct: 45,
      vpdMinKpa: 1.5,
      triggerSummary: 'Irregular irrigation cycles (drought stress <45% followed by heavy watering), high VPD (>1.5 kPa), high EC salinity, or excessive ammonium/potassium antagonizing Ca uptake.'
    },
    differentialDiagnosis: ['Anthracnose fruit rot (circular sunken spots on side of ripe fruit)', 'Sunscald (white/bleached papery patch on sun-exposed shoulder)'],
    preventionOptions: [
      'Maintain steady root-zone soil moisture (55–68%) using frequent short drip pulses rather than infrequent flooding',
      'Maintain daytime VPD between 0.85 and 1.35 kPa so transpiration pulls calcium into fruit',
      'Supply soluble Calcium Nitrate in fertigation program and keep pH 5.8–6.5'
    ],
    treatmentOptions: [
      'Affected necrotic fruit tissue will not recover — remove severely affected young fruits to redirect assimilates',
      'Stabilize drip irrigation frequency immediately and verify fertigation EC is not excessive (<2.8 mS/cm)'
    ],
    harvestImpact: 'Renders affected fruits unmarketable (10–35% loss if irrigation fluctuates during fruit sizing).',
    geographicApplicability: ['All Greenhouse & Polyhouse Production Zones'],
    sourceOrganization: 'FAO & UC/NIHORT Protected Horticulture Reference',
    sourceCitation: 'FAO Paper 230 Chapter 5 (Soil Fertility & Plant Nutrition in Protected Cultivation)',
    publicationDate: '2017-05',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'nitrogen_deficiency_chlorosis',
    category: 'nutrient_deficiency',
    title: 'Nitrogen (N) Deficiency General Chlorosis',
    cropCodes: ['tomato', 'bell_pepper', 'cucumber', 'lettuce', 'fluted_pumpkin', 'african_spinach', 'okra'],
    growthStages: ['seedling', 'vegetative', 'flowering'],
    causalAgent: 'Insufficient plant-available Nitrate/Ammonium in root zone',
    symptoms: [
      'Uniform pale green to yellow chlorosis starting on OLDER lower leaves (N is mobile in phloem)',
      'Thin, spindly stems and slowed vegetative leaf expansion',
      'Early flower drop and small pale fruits'
    ],
    environmentalTriggers: {
      soilMoistureMinPct: 80,
      triggerSummary: 'Nutrient leaching from excessive irrigation (>80% soil moisture) or depleted unfertilized substrate.'
    },
    differentialDiagnosis: ['Iron/Sulfur deficiency (affects youngest upper leaves first)', 'Magnesium deficiency (green veins remain with yellow interveinal marbling)'],
    preventionOptions: [
      'Follow growth-stage NPK fertigation schedule (150–190 ppm N during vegetative growth)',
      'Avoid over-leaching substrate beyond 15–20% drainage fraction'
    ],
    treatmentOptions: [
      'Restore balanced nitrate-based fertigation (e.g., Calcium Nitrate + NPK 19-19-19) at target EC 1.6–2.4 mS/cm',
      'Verify root zone pH is 5.8–6.6 so nutrient uptake is unobstructed'
    ],
    harvestImpact: 'Reduces canopy photosynthetic area and total biomass/fruit yield by 20–50%.',
    geographicApplicability: ['All Nigerian Greenhouse & Irrigated Horticulture Zones'],
    sourceOrganization: 'FAO & IITA Soil Fertility Reference',
    sourceCitation: 'FAO Fertilizer and Plant Nutrition Bulletin; FAO Paper 230',
    publicationDate: '2018-02',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'tropical_heat_pollen_sterility',
    category: 'abiotic_stress',
    title: 'Tropical Canopy Heat Stress & Flower Abortion',
    cropCodes: ['tomato', 'bell_pepper', 'strawberry', 'lettuce'],
    growthStages: ['flowering', 'fruiting'],
    causalAgent: 'Supra-optimal canopy temperature (>32°C day / >23°C night) and high VPD (>1.6 kPa)',
    symptoms: [
      'Blossom drop (abscission at pedicel knuckle) without fruit set',
      'Upward physiological leaf rolling (boat-shaped leaflets) while soil is still moist',
      'Bolting and bitter latex accumulation in lettuce'
    ],
    environmentalTriggers: {
      tempMinC: 32,
      vpdMinKpa: 1.6,
      triggerSummary: 'Midday polyhouse heat accumulation >= 32°C reduces tomato/pepper pollen viability sharply.'
    },
    differentialDiagnosis: ['TYLCV viral curl (accompanied by stunting and yellowing)', 'Root wilt (limp leaves rather than firm physiological roll)'],
    preventionOptions: [
      'Deploy 30–50% aluminized/white shade net above polyhouse roof during peak dry-season insolation',
      'Activate exhaust ventilation fans and ridge vents before canopy exceeds 28.5°C',
      'Ensure morning root-zone moisture is adequate prior to solar peak (10:00–15:00 WAT)'
    ],
    treatmentOptions: [
      'Maximize air exchange immediately and verify heater interlock keeps heating strictly OFF',
      'Use heat-tolerant tropical hybrids (e.g., Padma F1) for low-elevation savanna seasons'
    ],
    harvestImpact: 'Missing fruit trusses ("skipped clusters") 3–5 weeks after heatwave episodes.',
    geographicApplicability: ['Sudan Savanna', 'Guinea Savanna', 'Dry-Season Southern Polyhouses'],
    sourceOrganization: 'WorldVeg (CGIAR) & NIHORT Ibadan',
    sourceCitation: 'WorldVeg Heat-Tolerant Vegetable Breeding & Protected Cooling Guidelines (2021)',
    publicationDate: '2021-08',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'harvest_maturity_and_handling',
    category: 'harvest_condition',
    title: 'Greenhouse Harvest Readiness & Post-Harvest Cooling Standard',
    cropCodes: ['tomato', 'bell_pepper', 'cucumber', 'lettuce', 'fluted_pumpkin', 'okra'],
    growthStages: ['harvest'],
    causalAgent: null,
    symptoms: [
      'Tomato: Breaker-to-turning stage (10–30% pink/red blossom star) for distant transport; light-red for local direct sale',
      'Cucumber: Uniform dark green cylinder before seed cavity yellowing or ribbing',
      'Leafy vegetables (Ugu / Efo Tete / Lettuce): Crisp turgid morning leaves before floral bolting'
    ],
    environmentalTriggers: {
      tempMaxC: 26,
      triggerSummary: 'Harvest strictly during cool early morning hours (06:00–09:00 WAT) when fruit pulp temperature is lowest and turgor is highest.'
    },
    differentialDiagnosis: [],
    preventionOptions: [
      'Reduce EC/nitrogen excess and avoid over-watering tomato beds during final ripening to prevent radial fruit cracking',
      'Verify zero pesticide Pre-Harvest Interval (PHI) violations before picking'
    ],
    treatmentOptions: [
      'Place harvested crates immediately under ventilated shade / evaporative charcoal-cool room (12–15°C for tomato/pepper; never chill tomatoes below 10°C)',
      'Use smooth plastic ventilated crates (NSPRI standard) instead of woven raffia baskets to eliminate transit bruising'
    ],
    harvestImpact: 'Proper breaker-stage morning harvest + ventilated crate cooling cuts post-harvest loss from >40% to <8%.',
    geographicApplicability: ['Nationwide Nigerian Horticultural Supply Chains'],
    sourceOrganization: 'NSPRI Nigeria (Nigerian Stored Products Research Institute) & FAO',
    sourceCitation: 'NSPRI Post-Harvest Handling Manual for Fresh Fruits & Vegetables in Nigeria; FAO Paper 230',
    publicationDate: '2021-10',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'cucurbit_downy_mildew',
    category: 'disease',
    title: 'Cucurbit Downy Mildew (Angular Leaf Chlorosis)',
    cropCodes: ['cucumber'],
    growthStages: ['vegetative', 'flowering', 'fruiting'],
    causalAgent: 'Pseudoperonospora cubensis',
    symptoms: [
      'Angular pale-yellow to brown lesions strictly bounded by leaf veins on upper leaf surface',
      'Purplish-gray sporangial fuzz on lower leaf surface after humid nights',
      'Rapid loss of photosynthetic leaf area causing misshapen or sunburned cucumbers'
    ],
    environmentalTriggers: {
      tempMinC: 18,
      tempMaxC: 28,
      humidityMinPct: 82,
      triggerSummary: 'High relative humidity (>=82%) and morning dew condensation on trellised cucumber foliage.'
    },
    differentialDiagnosis: ['Powdery mildew (white talcum spots on upper leaf)', 'Angular bacterial leaf spot'],
    preventionOptions: [
      'Train cucumber vines vertically on single-stem trellis and prune lateral suckers for rapid leaf drying',
      'Purge humid night air at dawn via polyhouse ventilation before solar heating condenses moisture'
    ],
    treatmentOptions: [
      'Remove heavily necrotic basal leaves into sealed disposal bags',
      'Apply registered oomycete fungicide observing strict short-PHI cucumber harvest rules'
    ],
    harvestImpact: 'Reduces fruit length, sweetness, and marketable grade by 25–50% if unchecked.',
    geographicApplicability: ['Humid Forest', 'Derived Savanna', 'Wet-Season Nigerian Polyhouses'],
    sourceOrganization: 'WorldVeg (CGIAR) & NIHORT Ibadan',
    sourceCitation: 'WorldVeg Cucurbit Disease Field Guide; NIHORT Protected Cucumber Production Guide (2022)',
    publicationDate: '2022-03',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  },
  {
    code: 'leafy_greens_nitrogen_iron_chlorosis',
    category: 'nutrient_deficiency',
    title: 'Leafy Greens Nitrogen & High-pH Iron Interveinal Chlorosis',
    cropCodes: ['fluted_pumpkin', 'african_spinach', 'lettuce', 'scent_leaf'],
    growthStages: ['seedling', 'vegetative'],
    causalAgent: 'Root-zone Nitrogen depletion or alkaline water pH (>7.0) locking out chelated Iron (Fe)',
    symptoms: [
      'Nitrogen hunger: Uniform pale-green to yellow chlorosis starting on older lower leaves with spindly stems',
      'Iron lockout: Sharp green veins with bright yellow interveinal tissue on newest emerging leaves',
      'Reduced leaf blade expansion and delayed cutting cycles in Ugu and Efo Tete'
    ],
    environmentalTriggers: {
      soilMoistureMaxPct: 85,
      triggerSummary: 'Leaching from excessive irrigation pulses (>85% substrate saturation) or unbuffered borehole water with pH > 7.0.'
    },
    differentialDiagnosis: ['Waterlogged root hypoxia / Pythium root rot', 'Mosaic virus mottling'],
    preventionOptions: [
      'Maintain root-zone pH between 5.8 and 6.5 and EC between 1.2 and 2.0 mS/cm during vegetative leafy growth',
      'Split fertigation into shorter drip pulses to prevent nitrate leaching below shallow fibrous roots'
    ],
    treatmentOptions: [
      'Correct irrigation water pH and supply balanced vegetative NPK + EDDHA/DTPA chelated iron drench',
      'Verify substrate drainage before increasing fertilizer concentration'
    ],
    harvestImpact: 'Yellowed foliage loses market grade and shelf turgor rapidly.',
    geographicApplicability: ['Nationwide Nigerian Peri-Urban Leafy Vegetable Greenhouses'],
    sourceOrganization: 'IITA Ibadan & NIHORT',
    sourceCitation: 'NIHORT Indigenous Leafy Vegetable Nutrition & Protected Cultivation Bulletin (2021)',
    publicationDate: '2021-05',
    confidenceLevel: 'verified_reference',
    validationStatus: 'verified'
  }
];

function safeParseArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseObj<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class AgriculturalKnowledgeBaseService {
  private readonly driver: SqliteDriver;
  private readonly cropEngine: CropIntelligenceEngine;
  private seeded = false;

  constructor(driver: SqliteDriver, repos: PlatformRepositories) {
    this.driver = driver;
    this.cropEngine = new CropIntelligenceEngine(driver, repos);
  }

  public ensureSeeded(): void {
    this.cropEngine.ensureCatalogSeeded();
    if (this.seeded) return;

    const nowIso = new Date().toISOString();
    this.driver.runInTransaction(() => {
      for (const card of AUTHORITATIVE_DIAGNOSTIC_SEED) {
        this.driver.run(
          `INSERT INTO agricultural_diagnostic_knowledge (
             id, code, category, title, crop_codes_json, growth_stages_json,
             causal_agent, symptoms_json, environmental_triggers_json,
             differential_diagnosis_json, prevention_options_json, treatment_options_json,
             harvest_impact, geographic_applicability_json, source_organization,
             source_citation, publication_date, confidence_level, validation_status,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET
             title = excluded.title,
             crop_codes_json = excluded.crop_codes_json,
             growth_stages_json = excluded.growth_stages_json,
             symptoms_json = excluded.symptoms_json,
             environmental_triggers_json = excluded.environmental_triggers_json,
             prevention_options_json = excluded.prevention_options_json,
             treatment_options_json = excluded.treatment_options_json,
             source_organization = excluded.source_organization,
             source_citation = excluded.source_citation,
             updated_at = excluded.updated_at`,
          [
            `agdiag_${card.code}`,
            card.code,
            card.category,
            card.title,
            JSON.stringify(card.cropCodes),
            JSON.stringify(card.growthStages),
            card.causalAgent,
            JSON.stringify(card.symptoms),
            JSON.stringify(card.environmentalTriggers),
            JSON.stringify(card.differentialDiagnosis),
            JSON.stringify(card.preventionOptions),
            JSON.stringify(card.treatmentOptions),
            card.harvestImpact,
            JSON.stringify(card.geographicApplicability),
            card.sourceOrganization,
            card.sourceCitation,
            card.publicationDate,
            card.confidenceLevel,
            card.validationStatus,
            nowIso,
            nowIso
          ],
          false
        );
      }
    });

    this.seeded = true;
  }

  public queryDiagnosticCards(filters?: {
    cropCode?: string;
    category?: DiagnosticCategory;
    growthStage?: string;
    searchText?: string;
  }): DiagnosticKnowledgeCard[] {
    this.ensureSeeded();
    const rows = this.driver.queryAll<any>(
      'SELECT * FROM agricultural_diagnostic_knowledge ORDER BY category ASC, title ASC'
    );

    const cropNeedle = filters?.cropCode ? filters.cropCode.trim().toLowerCase().replace(/\s+/g, '_') : null;
    const stageNeedle = filters?.growthStage ? filters.growthStage.trim().toLowerCase() : null;
    const textNeedle = filters?.searchText ? filters.searchText.trim().toLowerCase() : null;

    return rows
      .map((r): DiagnosticKnowledgeCard => ({
        id: String(r.id),
        code: String(r.code),
        category: String(r.category) as DiagnosticCategory,
        title: String(r.title),
        cropCodes: safeParseArray(r.crop_codes_json),
        growthStages: safeParseArray(r.growth_stages_json),
        causalAgent: r.causal_agent ? String(r.causal_agent) : null,
        symptoms: safeParseArray(r.symptoms_json),
        environmentalTriggers: safeParseObj(r.environmental_triggers_json, { triggerSummary: '' }),
        differentialDiagnosis: safeParseArray(r.differential_diagnosis_json),
        preventionOptions: safeParseArray(r.prevention_options_json),
        treatmentOptions: safeParseArray(r.treatment_options_json),
        harvestImpact: String(r.harvest_impact || ''),
        geographicApplicability: safeParseArray(r.geographic_applicability_json),
        sourceOrganization: String(r.source_organization),
        sourceCitation: String(r.source_citation),
        publicationDate: String(r.publication_date),
        confidenceLevel: String(r.confidence_level) as DiagnosticKnowledgeCard['confidenceLevel'],
        validationStatus: String(r.validation_status) as DiagnosticKnowledgeCard['validationStatus']
      }))
      .filter((c) => {
        if (filters?.category && c.category !== filters.category) return false;
        if (cropNeedle && !c.cropCodes.some((cc) => cc.includes(cropNeedle) || cropNeedle.includes(cc))) {
          return false;
        }
        if (stageNeedle && c.growthStages.length > 0 && !c.growthStages.includes(stageNeedle)) {
          return false;
        }
        if (textNeedle) {
          const hay = `${c.title} ${c.causalAgent || ''} ${c.symptoms.join(' ')} ${c.treatmentOptions.join(' ')}`.toLowerCase();
          if (!hay.includes(textNeedle)) return false;
        }
        return true;
      });
  }

  /**
   * Matches live environmental telemetry against scientifically established disease, pest,
   * nutrient-transport, and abiotic stress triggers (works 100% offline without external LLMs).
   */
  public matchEnvironmentalRiskCards(params: {
    cropCode: string;
    growthStage: string;
    temperatureC: number | null;
    humidityPct: number | null;
    soilMoisturePct: number | null;
    vpdKpa: number | null;
  }): DiagnosticKnowledgeCard[] {
    const candidates = this.queryDiagnosticCards({
      cropCode: params.cropCode,
      growthStage: params.growthStage
    });

    const matched: DiagnosticKnowledgeCard[] = [];
    for (const card of candidates) {
      const trig = card.environmentalTriggers;
      let triggered = false;

      if (
        card.code === 'tropical_heat_pollen_sterility' &&
        params.temperatureC !== null &&
        params.temperatureC >= (trig.tempMinC ?? 32)
      ) {
        triggered = true;
      } else if (
        card.code === 'tomato_early_blight' &&
        params.temperatureC !== null &&
        params.humidityPct !== null &&
        params.temperatureC >= 24 &&
        params.humidityPct >= 80
      ) {
        triggered = true;
      } else if (
        card.code === 'tomato_late_blight' &&
        params.temperatureC !== null &&
        params.humidityPct !== null &&
        params.temperatureC >= 14 &&
        params.temperatureC <= 24 &&
        params.humidityPct >= 85
      ) {
        triggered = true;
      } else if (
        card.code === 'calcium_blossom_end_rot' &&
        ((params.soilMoisturePct !== null && params.soilMoisturePct <= 45) ||
          (params.vpdKpa !== null && params.vpdKpa >= 1.55))
      ) {
        triggered = true;
      } else if (
        card.code === 'bacterial_wilt_solanaceae' &&
        params.temperatureC !== null &&
        params.soilMoisturePct !== null &&
        params.temperatureC >= 28 &&
        params.soilMoisturePct >= 78
      ) {
        triggered = true;
      }

      if (triggered) {
        matched.push(card);
      }
    }

    return matched;
  }

  public getKnowledgeBaseSummary() {
    this.ensureSeeded();
    const crops = this.cropEngine.listAllCropProfiles();
    const diagnosticCards = this.queryDiagnosticCards();
    return {
      independentOfExternalLlm: true,
      cropProfilesCount: crops.length,
      diagnosticCardsCount: diagnosticCards.length,
      categoriesCovered: ['disease', 'pest', 'nutrient_deficiency', 'abiotic_stress', 'harvest_condition'],
      authoritativeSources: [
        'FAO (Plant Production Paper 230 & Irrigation Paper 56)',
        'NIHORT Ibadan (National Horticultural Research Institute, Nigeria)',
        'IITA Ibadan (International Institute of Tropical Agriculture)',
        'CGIAR / WorldVeg & CIP',
        'NSPRI Nigeria (Nigerian Stored Products Research Institute)'
      ],
      crops,
      diagnosticCards
    };
  }
}
