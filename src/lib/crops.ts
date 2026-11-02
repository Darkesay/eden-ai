/**
 * Standard growing periods (seedling/planting to harvest) and optimal environmental targets
 * for greenhouse & Nigerian staple crops.
 * Used across HarvestAgent, HarvestWidget, Settings, GreenhouseSetupWizard, and GreenhouseDetails.
 */

export interface CropMaturityProfile {
  id: string;
  label: string;
  localLabel?: string;
  scientificName: string;
  standardDays: number;
  tempMin: number;
  tempMax: number;
  humMin: number;
  humMax: number;
  soilMin: number;
  soilMax: number;
  optimalTempRange: string;
  optimalMoistureRange: string;
  description: string;
}

export const SUPPORTED_HARVEST_CROPS: CropMaturityProfile[] = [
  {
    id: 'tomato',
    label: 'Tomato',
    localLabel: 'Tumatir / Tòmátì',
    scientificName: 'Solanum lycopersicum',
    standardDays: 70,
    tempMin: 20,
    tempMax: 28,
    humMin: 55,
    humMax: 75,
    soilMin: 50,
    soilMax: 65,
    optimalTempRange: '20–28°C',
    optimalMoistureRange: '50–65%',
    description: 'Requires warm daytime air, steady root moisture, and good airflow to prevent early blight.'
  },
  {
    id: 'pepper',
    label: 'Bell Pepper',
    localLabel: 'Tattasai / Ata Rodo',
    scientificName: 'Capsicum annuum',
    standardDays: 80,
    tempMin: 22,
    tempMax: 29,
    humMin: 50,
    humMax: 70,
    soilMin: 50,
    soilMax: 65,
    optimalTempRange: '22–29°C',
    optimalMoistureRange: '50–65%',
    description: 'Thrives in warm, well-drained beds with consistent morning drip irrigation and calcium balance.'
  },
  {
    id: 'habanero',
    label: 'Scotch Bonnet / Habanero',
    localLabel: 'Atarugu / Ata Rodo',
    scientificName: 'Capsicum chinense',
    standardDays: 85,
    tempMin: 22,
    tempMax: 31,
    humMin: 50,
    humMax: 70,
    soilMin: 45,
    soilMax: 60,
    optimalTempRange: '22–31°C',
    optimalMoistureRange: '45–60%',
    description: 'Loves warm conditions and bright light. Sensitive to root waterlogging—avoid overwatering.'
  },
  {
    id: 'cucumber',
    label: 'Cucumber',
    localLabel: 'Kokwamba / Kúkúmbà',
    scientificName: 'Cucumis sativus',
    standardDays: 55,
    tempMin: 22,
    tempMax: 29,
    humMin: 60,
    humMax: 80,
    soilMin: 55,
    soilMax: 70,
    optimalTempRange: '22–29°C',
    optimalMoistureRange: '55–70%',
    description: 'Fast-growing vine with high water demand. Benefits from trellising and morning irrigation.'
  },
  {
    id: 'lettuce',
    label: 'Lettuce',
    localLabel: 'Latas / Salad',
    scientificName: 'Lactuca sativa',
    standardDays: 45,
    tempMin: 16,
    tempMax: 24,
    humMin: 50,
    humMax: 70,
    soilMin: 55,
    soilMax: 70,
    optimalTempRange: '16–24°C',
    optimalMoistureRange: '55–70%',
    description: 'Cool-canopy leafy green. High heat triggers bolting and bitterness—keep shaded in midday sun.'
  },
  {
    id: 'spinach',
    label: 'Spinach / Green Amaranth',
    localLabel: 'Alayyahu / Efo Tete',
    scientificName: 'Amaranthus hybridus',
    standardDays: 40,
    tempMin: 20,
    tempMax: 28,
    humMin: 55,
    humMax: 75,
    soilMin: 55,
    soilMax: 70,
    optimalTempRange: '20–28°C',
    optimalMoistureRange: '55–70%',
    description: 'Quick-maturing leafy green that responds rapidly to nitrogen-rich compost and even moisture.'
  },
  {
    id: 'ugwu',
    label: 'Fluted Pumpkin (Ugwu)',
    localLabel: 'Ugwu / Ikong-Ubong',
    scientificName: 'Telfairia occidentalis',
    standardDays: 45,
    tempMin: 22,
    tempMax: 30,
    humMin: 60,
    humMax: 85,
    soilMin: 55,
    soilMax: 75,
    optimalTempRange: '22–30°C',
    optimalMoistureRange: '55–75%',
    description: 'Vigorous tropical leafy crop producing lush shoots under warm, humid drip-irrigated care.'
  },
  {
    id: 'kale',
    label: 'Kale',
    localLabel: 'Kale',
    scientificName: 'Brassica oleracea',
    standardDays: 60,
    tempMin: 18,
    tempMax: 25,
    humMin: 50,
    humMax: 70,
    soilMin: 50,
    soilMax: 65,
    optimalTempRange: '18–25°C',
    optimalMoistureRange: '50–65%',
    description: 'Nutrient-dense brassica preferring moderate warmth, good ventilation, and neem pest protection.'
  },
  {
    id: 'okra',
    label: 'Okra',
    localLabel: 'Kubewa / Ilá / Okwuru',
    scientificName: 'Abelmoschus esculentus',
    standardDays: 55,
    tempMin: 24,
    tempMax: 32,
    humMin: 50,
    humMax: 75,
    soilMin: 45,
    soilMax: 65,
    optimalTempRange: '24–32°C',
    optimalMoistureRange: '45–65%',
    description: 'Heat-loving pod crop that flowers prolifically in bright sun with moderate root-zone moisture.'
  },
  {
    id: 'cabbage',
    label: 'Cabbage',
    localLabel: 'Kabeji',
    scientificName: 'Brassica oleracea var. capitata',
    standardDays: 80,
    tempMin: 18,
    tempMax: 25,
    humMin: 55,
    humMax: 75,
    soilMin: 55,
    soilMax: 70,
    optimalTempRange: '18–25°C',
    optimalMoistureRange: '55–70%',
    description: 'Forms firm heads when night temperatures stay cool and soil moisture remains uniform.'
  },
  {
    id: 'carrot',
    label: 'Carrot',
    localLabel: 'Karas',
    scientificName: 'Daucus carota',
    standardDays: 75,
    tempMin: 18,
    tempMax: 25,
    humMin: 50,
    humMax: 70,
    soilMin: 50,
    soilMax: 65,
    optimalTempRange: '18–25°C',
    optimalMoistureRange: '50–65%',
    description: 'Deep, loose, stone-free root bed crop needing gentle, steady moisture to prevent root splitting.'
  },
  {
    id: 'watermelon',
    label: 'Watermelon',
    localLabel: 'Kankana / Elegede',
    scientificName: 'Citrullus lanatus',
    standardDays: 85,
    tempMin: 24,
    tempMax: 31,
    humMin: 50,
    humMax: 70,
    soilMin: 45,
    soilMax: 60,
    optimalTempRange: '24–31°C',
    optimalMoistureRange: '45–60%',
    description: 'Warm-climate fruiting vine; reduce watering slightly during final ripening for sweeter fruit.'
  },
  {
    id: 'onion',
    label: 'Onion',
    localLabel: 'Albasa / Àlùbọ́sà',
    scientificName: 'Allium cepa',
    standardDays: 100,
    tempMin: 20,
    tempMax: 28,
    humMin: 45,
    humMax: 65,
    soilMin: 45,
    soilMax: 60,
    optimalTempRange: '20–28°C',
    optimalMoistureRange: '45–60%',
    description: 'Prefers lower air humidity and well-drained beds to prevent bulb rot and purple blotch.'
  },
  {
    id: 'beans',
    label: 'Cowpea / Beans',
    localLabel: 'Wake / Ẹ̀wà / Àgwà',
    scientificName: 'Vigna unguiculata',
    standardDays: 65,
    tempMin: 22,
    tempMax: 30,
    humMin: 45,
    humMax: 70,
    soilMin: 45,
    soilMax: 60,
    optimalTempRange: '22–30°C',
    optimalMoistureRange: '45–60%',
    description: 'Nitrogen-fixing legume adaptable to warm greenhouses; avoid excessive foliar dampness.'
  },
  {
    id: 'maize',
    label: 'Sweet Maize',
    localLabel: 'Masara / Àgbàdo / Ọkà',
    scientificName: 'Zea mays',
    standardDays: 90,
    tempMin: 22,
    tempMax: 30,
    humMin: 50,
    humMax: 75,
    soilMin: 50,
    soilMax: 65,
    optimalTempRange: '22–30°C',
    optimalMoistureRange: '50–65%',
    description: 'High-light cereal crop requiring reliable moisture especially during tasseling and silking.'
  },
  {
    id: 'rice',
    label: 'Upland Rice',
    localLabel: 'Shinkafa / Ìrẹsì / Osikapa',
    scientificName: 'Oryza sativa',
    standardDays: 120,
    tempMin: 24,
    tempMax: 32,
    humMin: 60,
    humMax: 85,
    soilMin: 65,
    soilMax: 80,
    optimalTempRange: '24–32°C',
    optimalMoistureRange: '65–80%',
    description: 'Warm, moisture-retentive grain trial crop suited for high-humidity nursery and seed beds.'
  },
  {
    id: 'yam',
    label: 'Seed Yam (Aeroponic/Minisett)',
    localLabel: 'Doya / Iṣu / Ji',
    scientificName: 'Dioscorea rotundata',
    standardDays: 270,
    tempMin: 25,
    tempMax: 31,
    humMin: 55,
    humMax: 75,
    soilMin: 50,
    soilMax: 65,
    optimalTempRange: '25–31°C',
    optimalMoistureRange: '50–65%',
    description: 'Clean seed-yam propagation under warm canopy temperatures and well-aerated root media.'
  },
  {
    id: 'cassava',
    label: 'Cassava Stem / Root',
    localLabel: 'Rogo / Ẹ̀gẹ́ / Akpụ',
    scientificName: 'Manihot esculenta',
    standardDays: 365,
    tempMin: 25,
    tempMax: 32,
    humMin: 50,
    humMax: 75,
    soilMin: 45,
    soilMax: 60,
    optimalTempRange: '25–32°C',
    optimalMoistureRange: '45–60%',
    description: 'Rapid virus-free stem multiplication and root establishment in warm, drained beds.'
  }
];

export function findSupportedCropProfile(cropType: string): CropMaturityProfile | undefined {
  const normalized = (cropType || '').trim().toLowerCase();
  if (!normalized) return undefined;

  const exact = SUPPORTED_HARVEST_CROPS.find(
    (c) => c.id === normalized || c.label.toLowerCase() === normalized
  );
  if (exact) return exact;

  return SUPPORTED_HARVEST_CROPS.find(
    (c) => normalized.includes(c.id) || c.label.toLowerCase().includes(normalized)
  );
}

export function getCropStandardDays(cropType: string): number {
  return findSupportedCropProfile(cropType)?.standardDays ?? 70;
}
