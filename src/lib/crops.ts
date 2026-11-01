/**
 * Standard growing periods (seedling/planting to harvest) for greenhouse & Nigerian staple crops.
 * Used by HarvestAgent, HarvestWidget, and Settings crop configuration.
 */

export interface CropMaturityProfile {
  id: string;
  label: string;
  localLabel?: string;
  standardDays: number;
  optimalTempRange: string;
  optimalMoistureRange: string;
}

export const SUPPORTED_HARVEST_CROPS: CropMaturityProfile[] = [
  { id: 'tomato', label: 'Tomato', localLabel: 'Tumatir / Tòmátì', standardDays: 70, optimalTempRange: '21–28°C', optimalMoistureRange: '50–65%' },
  { id: 'pepper', label: 'Bell Pepper', localLabel: 'Tattasai / Ata Rodo', standardDays: 80, optimalTempRange: '22–29°C', optimalMoistureRange: '50–65%' },
  { id: 'habanero', label: 'Scotch Bonnet / Habanero', localLabel: 'Atarugu / Ata Rodo', standardDays: 85, optimalTempRange: '23–30°C', optimalMoistureRange: '45–60%' },
  { id: 'cucumber', label: 'Cucumber', localLabel: 'Kokwamba / Kúkúmbà', standardDays: 55, optimalTempRange: '22–29°C', optimalMoistureRange: '55–70%' },
  { id: 'lettuce', label: 'Lettuce', localLabel: 'Latas', standardDays: 45, optimalTempRange: '18–24°C', optimalMoistureRange: '55–70%' },
  { id: 'spinach', label: 'Spinach / Green Amaranth', localLabel: 'Alayyahu / Efo Tete', standardDays: 40, optimalTempRange: '20–28°C', optimalMoistureRange: '55–70%' },
  { id: 'ugwu', label: 'Fluted Pumpkin (Ugwu)', localLabel: 'Ugwu / Ikong-Ubong', standardDays: 45, optimalTempRange: '22–30°C', optimalMoistureRange: '55–70%' },
  { id: 'kale', label: 'Kale', localLabel: 'Kale', standardDays: 60, optimalTempRange: '18–25°C', optimalMoistureRange: '50–65%' },
  { id: 'okra', label: 'Okra', localLabel: 'Kubewa / Ilá / Okwuru', standardDays: 55, optimalTempRange: '24–32°C', optimalMoistureRange: '45–65%' },
  { id: 'cabbage', label: 'Cabbage', localLabel: 'Kabeji', standardDays: 80, optimalTempRange: '18–25°C', optimalMoistureRange: '55–70%' },
  { id: 'carrot', label: 'Carrot', localLabel: 'Karas', standardDays: 75, optimalTempRange: '18–25°C', optimalMoistureRange: '50–65%' },
  { id: 'watermelon', label: 'Watermelon', localLabel: 'Kankana / Elegede', standardDays: 85, optimalTempRange: '24–31°C', optimalMoistureRange: '45–60%' },
  { id: 'onion', label: 'Onion', localLabel: 'Albasa / Àlùbọ́sà', standardDays: 100, optimalTempRange: '20–28°C', optimalMoistureRange: '45–60%' },
  { id: 'beans', label: 'Cowpea / Beans', localLabel: 'Wake / Ẹ̀wà / Àgwà', standardDays: 65, optimalTempRange: '22–30°C', optimalMoistureRange: '45–60%' },
  { id: 'maize', label: 'Sweet Maize', localLabel: 'Masara / Àgbàdo / Ọkà', standardDays: 90, optimalTempRange: '22–30°C', optimalMoistureRange: '50–65%' },
  { id: 'rice', label: 'Upland Rice', localLabel: 'Shinkafa / ìrẹsì / Osikapa', standardDays: 120, optimalTempRange: '24–32°C', optimalMoistureRange: '65–80%' },
  { id: 'yam', label: 'Seed Yam (Aeroponic/Minisett)', localLabel: 'Doya / Iṣu / Ji', standardDays: 270, optimalTempRange: '25–31°C', optimalMoistureRange: '50–65%' },
  { id: 'cassava', label: 'Cassava Stem / Root', localLabel: 'Rogo / Ẹ̀gẹ́ / Akpụ', standardDays: 365, optimalTempRange: '25–32°C', optimalMoistureRange: '45–60%' }
];

export function getCropStandardDays(cropType: string): number {
  const normalized = (cropType || '').trim().toLowerCase();
  if (!normalized) return 70;

  const exact = SUPPORTED_HARVEST_CROPS.find(
    (c) => c.id === normalized || c.label.toLowerCase() === normalized
  );
  if (exact) return exact.standardDays;

  for (const c of SUPPORTED_HARVEST_CROPS) {
    if (normalized.includes(c.id) || c.label.toLowerCase().includes(normalized)) {
      return c.standardDays;
    }
  }
  return 70;
}
