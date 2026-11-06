/**
 * EDENS AI — Universal Hardware Capability Registry
 * Hardware specifications, sensor bounds, and agricultural capability catalogs.
 */

import type {
  BoardCategory,
  Esp32ChipFamily,
  SensorCategory,
  SensorPhysicalBound,
  TelemetryQuality
} from './types.ts';

export interface BoardFamilySpec {
  chipFamily: Esp32ChipFamily;
  modelIdentifier: string;
  displayName: string;
  category: BoardCategory;
  defaultFlashMb: number;
  hasPsram: boolean;
  cameraCapable: boolean;
  clockSpeedMhz: number;
  coreCount: number;
  architecture: 'xtensa_lx6' | 'xtensa_lx7' | 'riscv_rv32imc' | 'unknown';
  supportedProtocols: Array<'mqtt' | 'http_rest' | 'websocket' | 'esphome_api' | 'thingsboard_v1'>;
  defaultFeatures: string[];
}

export const KNOWN_BOARD_SPECS: Record<string, BoardFamilySpec> = {
  esp32_devkit_v1: {
    chipFamily: 'esp32',
    modelIdentifier: 'esp32_devkit_v1',
    displayName: 'ESP32 DevKit V1 (ESP32-WROOM-32)',
    category: 'controller_standard',
    defaultFlashMb: 4,
    hasPsram: false,
    cameraCapable: false,
    clockSpeedMhz: 240,
    coreCount: 2,
    architecture: 'xtensa_lx6',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api', 'thingsboard_v1'],
    defaultFeatures: ['wifi_2.4g', 'ble_4.2', 'hardware_adc', 'i2c', 'spi', '1wire']
  },
  esp32_wroom: {
    chipFamily: 'esp32',
    modelIdentifier: 'esp32_wroom',
    displayName: 'ESP32-WROOM-32D / 32U Module',
    category: 'controller_standard',
    defaultFlashMb: 4,
    hasPsram: false,
    cameraCapable: false,
    clockSpeedMhz: 240,
    coreCount: 2,
    architecture: 'xtensa_lx6',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api', 'thingsboard_v1'],
    defaultFeatures: ['wifi_2.4g', 'ble_4.2', 'hardware_adc', 'i2c', 'spi', '1wire']
  },
  esp32_wrover: {
    chipFamily: 'esp32',
    modelIdentifier: 'esp32_wrover',
    displayName: 'ESP32-WROVER (4MB/8MB PSRAM)',
    category: 'controller_psram',
    defaultFlashMb: 8,
    hasPsram: true,
    cameraCapable: true,
    clockSpeedMhz: 240,
    coreCount: 2,
    architecture: 'xtensa_lx6',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api', 'thingsboard_v1'],
    defaultFeatures: ['wifi_2.4g', 'ble_4.2', 'psram_8mb', 'hardware_adc', 'i2c', 'spi']
  },
  esp32_s2: {
    chipFamily: 'esp32s2',
    modelIdentifier: 'esp32_s2',
    displayName: 'ESP32-S2 Saola / WROVER (Single Core, USB-OTG)',
    category: 'controller_standard',
    defaultFlashMb: 4,
    hasPsram: false,
    cameraCapable: false,
    clockSpeedMhz: 240,
    coreCount: 1,
    architecture: 'xtensa_lx7',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api'],
    defaultFeatures: ['wifi_2.4g', 'usb_otg', 'low_power_ulp', 'touch_sensors', 'hardware_adc']
  },
  esp32_s3: {
    chipFamily: 'esp32s3',
    modelIdentifier: 'esp32_s3',
    displayName: 'ESP32-S3 DevKitC / AI Acceleration Node',
    category: 'controller_psram',
    defaultFlashMb: 8,
    hasPsram: true,
    cameraCapable: true,
    clockSpeedMhz: 240,
    coreCount: 2,
    architecture: 'xtensa_lx7',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api', 'thingsboard_v1'],
    defaultFeatures: ['wifi_2.4g', 'ble_5.0', 'vector_ai_instructions', 'usb_serial_jtag', 'psram_8mb']
  },
  esp32_c3: {
    chipFamily: 'esp32c3',
    modelIdentifier: 'esp32_c3',
    displayName: 'ESP32-C3 DevKitM (RISC-V Single Core)',
    category: 'controller_standard',
    defaultFlashMb: 4,
    hasPsram: false,
    cameraCapable: false,
    clockSpeedMhz: 160,
    coreCount: 1,
    architecture: 'riscv_rv32imc',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket', 'esphome_api'],
    defaultFeatures: ['wifi_2.4g', 'ble_5.0', 'riscv_core', 'hardware_crypto']
  },
  esp32_cam: {
    chipFamily: 'esp32',
    modelIdentifier: 'esp32_cam',
    displayName: 'AI-Thinker ESP32-CAM (OV2640 / PSRAM)',
    category: 'camera_node',
    defaultFlashMb: 4,
    hasPsram: true,
    cameraCapable: true,
    clockSpeedMhz: 240,
    coreCount: 2,
    architecture: 'xtensa_lx6',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket'],
    defaultFeatures: ['camera_ov2640', 'psram_4mb', 'sd_card_slot', 'onboard_flash_led', 'dual_port_webserver']
  },
  esp32_s3_cam: {
    chipFamily: 'esp32s3',
    modelIdentifier: 'esp32_s3_cam',
    displayName: 'ESP32-S3-CAM (Freenove / Seeed XIAO Sense)',
    category: 'camera_node',
    defaultFlashMb: 8,
    hasPsram: true,
    cameraCapable: true,
    clockSpeedMhz: 240,
    coreCount: 2,
    architecture: 'xtensa_lx7',
    supportedProtocols: ['http_rest', 'mqtt', 'websocket'],
    defaultFeatures: ['camera_ov2640_ov5640', 'psram_8mb', 'vector_ai_instructions', 'microphone_pdm', 'sd_card']
  }
};

export const SENSOR_BOUNDS_CATALOG: Record<SensorCategory, SensorPhysicalBound> = {
  temperature: {
    category: 'temperature',
    canonicalUnit: '°C',
    defaultLabel: 'Canopy Air Temperature',
    minPhysical: -40,
    maxPhysical: 125,
    typicalGreenhouseMin: 5,
    typicalGreenhouseMax: 50
  },
  humidity: {
    category: 'humidity',
    canonicalUnit: '%',
    defaultLabel: 'Relative Air Humidity',
    minPhysical: 0,
    maxPhysical: 100,
    typicalGreenhouseMin: 20,
    typicalGreenhouseMax: 98
  },
  soil_moisture: {
    category: 'soil_moisture',
    canonicalUnit: '%',
    defaultLabel: 'Root-Zone Volumetric Moisture',
    minPhysical: 0,
    maxPhysical: 100,
    typicalGreenhouseMin: 15,
    typicalGreenhouseMax: 90
  },
  light_intensity: {
    category: 'light_intensity',
    canonicalUnit: 'lux',
    defaultLabel: 'Canopy Solar Light Intensity',
    minPhysical: 0,
    maxPhysical: 250000,
    typicalGreenhouseMin: 0,
    typicalGreenhouseMax: 120000
  },
  co2: {
    category: 'co2',
    canonicalUnit: 'ppm',
    defaultLabel: 'Ambient CO2 Concentration',
    minPhysical: 200,
    maxPhysical: 10000,
    typicalGreenhouseMin: 350,
    typicalGreenhouseMax: 2000
  },
  water_level: {
    category: 'water_level',
    canonicalUnit: '%',
    defaultLabel: 'Reservoir Tank Water Level',
    minPhysical: 0,
    maxPhysical: 100,
    typicalGreenhouseMin: 10,
    typicalGreenhouseMax: 100
  },
  ph: {
    category: 'ph',
    canonicalUnit: 'pH',
    defaultLabel: 'Nutrient / Root-Zone pH',
    minPhysical: 0.0,
    maxPhysical: 14.0,
    typicalGreenhouseMin: 4.5,
    typicalGreenhouseMax: 8.5
  },
  ec: {
    category: 'ec',
    canonicalUnit: 'mS/cm',
    defaultLabel: 'Nutrient Electrical Conductivity',
    minPhysical: 0.0,
    maxPhysical: 20.0,
    typicalGreenhouseMin: 0.8,
    typicalGreenhouseMax: 4.0
  },
  atmospheric_pressure: {
    category: 'atmospheric_pressure',
    canonicalUnit: 'hPa',
    defaultLabel: 'Barometric Atmospheric Pressure',
    minPhysical: 700,
    maxPhysical: 1200,
    typicalGreenhouseMin: 950,
    typicalGreenhouseMax: 1050
  },
  rainfall: {
    category: 'rainfall',
    canonicalUnit: 'mm',
    defaultLabel: 'Precipitation Gauge / Rain State',
    minPhysical: 0,
    maxPhysical: 500,
    typicalGreenhouseMin: 0,
    typicalGreenhouseMax: 100
  },
  battery_voltage: {
    category: 'battery_voltage',
    canonicalUnit: 'V',
    defaultLabel: 'Node Battery / DC Supply Voltage',
    minPhysical: 0.0,
    maxPhysical: 48.0,
    typicalGreenhouseMin: 3.0,
    typicalGreenhouseMax: 15.0
  },
  leaf_wetness: {
    category: 'leaf_wetness',
    canonicalUnit: '%',
    defaultLabel: 'Canopy Leaf Wetness Index',
    minPhysical: 0,
    maxPhysical: 100,
    typicalGreenhouseMin: 0,
    typicalGreenhouseMax: 100
  },
  par_light: {
    category: 'par_light',
    canonicalUnit: 'µmol/m²/s',
    defaultLabel: 'Photosynthetically Active Radiation',
    minPhysical: 0,
    maxPhysical: 3000,
    typicalGreenhouseMin: 0,
    typicalGreenhouseMax: 2000
  },
  custom: {
    category: 'custom',
    canonicalUnit: 'units',
    defaultLabel: 'Custom Agricultural Probe',
    minPhysical: -1000000,
    maxPhysical: 1000000,
    typicalGreenhouseMin: -1000000,
    typicalGreenhouseMax: 1000000
  }
};

export class CapabilityRegistry {
  private readonly customBounds = new Map<string, SensorPhysicalBound>();

  public normalizeRawKeyToCategory(rawKey: string): SensorCategory | null {
    const k = rawKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['temperature', 'temp', 'temp_c', 'temperature_c', 'air_temp', 'canopy_temp'].includes(k)) {
      return 'temperature';
    }
    if (['humidity', 'rh', 'humidity_pct', 'relative_humidity', 'air_humidity'].includes(k)) {
      return 'humidity';
    }
    if (['soilmoisture', 'soil_moisture', 'soil_moisture_pct', 'soil', 'root_moisture'].includes(k)) {
      return 'soil_moisture';
    }
    if (['sunlight', 'light', 'lux', 'sunlight_lux', 'light_intensity', 'illuminance'].includes(k)) {
      return 'light_intensity';
    }
    if (['co2', 'co2_ppm', 'carbon_dioxide'].includes(k)) {
      return 'co2';
    }
    if (['waterlevel', 'water_level', 'water_level_pct', 'tank_level', 'reservoir_level'].includes(k)) {
      return 'water_level';
    }
    if (['ph', 'soil_ph', 'water_ph', 'solution_ph'].includes(k)) {
      return 'ph';
    }
    if (['ec', 'ec_ms_cm', 'electrical_conductivity', 'tds'].includes(k)) {
      return 'ec';
    }
    if (['pressure', 'barometer', 'atmospheric_pressure', 'air_pressure', 'hpa'].includes(k)) {
      return 'atmospheric_pressure';
    }
    if (['rainfall', 'rain', 'rain_gauge', 'rain_gauge_level', 'precipitation', 'rain_detected'].includes(k)) {
      return 'rainfall';
    }
    if (['battery', 'vbat', 'battery_voltage', 'supply_voltage', 'voltage'].includes(k)) {
      return 'battery_voltage';
    }
    if (['leaf_wetness', 'foliage_wetness', 'wetness'].includes(k)) {
      return 'leaf_wetness';
    }
    if (['par', 'par_light', 'ppfd'].includes(k)) {
      return 'par_light';
    }
    return null;
  }

  public getSensorBounds(category: SensorCategory): SensorPhysicalBound {
    return this.customBounds.get(category) || SENSOR_BOUNDS_CATALOG[category] || SENSOR_BOUNDS_CATALOG.custom;
  }

  public validateReadingSanity(category: SensorCategory, val: number | null): {
    quality: TelemetryQuality;
    sanitizedValue: number | null;
    isOutOfRange: boolean;
    reason?: string;
  } {
    if (val === null || val === undefined || Number.isNaN(val)) {
      return { quality: 'unavailable', sanitizedValue: null, isOutOfRange: false, reason: 'Probe unpopulated or disconnected' };
    }
    const bounds = this.getSensorBounds(category);
    if (val < bounds.minPhysical || val > bounds.maxPhysical) {
      return {
        quality: 'sensor_fault',
        sanitizedValue: val,
        isOutOfRange: true,
        reason: `Value ${val} violates absolute physical limits [${bounds.minPhysical}, ${bounds.maxPhysical}] for ${category}`
      };
    }
    if (val < bounds.typicalGreenhouseMin || val > bounds.typicalGreenhouseMax) {
      return {
        quality: 'out_of_range',
        sanitizedValue: val,
        isOutOfRange: true,
        reason: `Value ${val} outside normal agronomic greenhouse bounds [${bounds.typicalGreenhouseMin}, ${bounds.typicalGreenhouseMax}]`
      };
    }
    return { quality: 'valid', sanitizedValue: Number(val.toFixed(4)), isOutOfRange: false };
  }

  public getBoardSpec(modelOrChip: string): BoardFamilySpec | null {
    const clean = modelOrChip.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (KNOWN_BOARD_SPECS[clean]) {
      return KNOWN_BOARD_SPECS[clean];
    }
    // Partial substring matches
    for (const [key, spec] of Object.entries(KNOWN_BOARD_SPECS)) {
      if (clean.includes(key) || clean.includes(spec.chipFamily)) {
        return spec;
      }
    }
    return null;
  }

  public listSupportedBoardProfiles(): BoardFamilySpec[] {
    return Object.values(KNOWN_BOARD_SPECS);
  }
}

export const globalCapabilityRegistry = new CapabilityRegistry();
