/**
 * EDENS AI Frontend Intelligence Client
 * Routes all Gemini AI operations strictly through server-side /api/ai/* endpoints.
 * Never imports @google/genai or exposes GEMINI_API_KEY in client bundles.
 */

export interface PlantAnalysisResult {
  species: string;
  speciesLocal?: string;
  healthStatus: string;
  healthStatusLocal?: string;
  symptoms: string;
  cause: string;
  recommendation: string;
  language?: string;
  audioSummary?: string;
  imageSource?: 'ESP32_CAM_FRESH' | 'ESP32_CAM_HISTORICAL' | 'MANUAL_UPLOAD';
  frameId?: string;
  frameTimestamp?: string;
  frameAgeSeconds?: number;
}

export interface HarvestPredictionResult {
  estimatedDaysTotal: number;
  daysSaved: number;
  daysRemaining: number;
  estimatedHarvestDate: string;
  confidence: number;
  factors: {
    name: string;
    impact: number;
    explanation: string;
  }[];
}

export interface NigerianLanguage {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  flag: string;
  welcomeGreeting: string;
  sampleQuestions: string[];
  speechCode?: string;
}

export const NIGERIAN_LANGUAGES: NigerianLanguage[] = [
  {
    id: 'ha',
    name: 'Hausa',
    nativeName: 'Harshen Hausa',
    region: 'Northern Nigeria / Arewa',
    flag: '🇳🇬',
    welcomeGreeting: 'Sannu da zuwa EDENS AI! Ni ne masanin shuke-shuke da amfanin gona. Tambaye ni komai game da tsirranku.',
    sampleQuestions: [
      'Yaya zan magance kwari a jikin ganyen tumatir?',
      'Me ya sa ganyen shukata ke canza launi zuwa rawaya?',
      'Wace irin taki ce ta fi dacewa da barkono a greenhouse?',
      'Ta yaya zan daidaita ruwa da zafin dakin shuka?'
    ],
    speechCode: 'ha-NG'
  },
  {
    id: 'ig',
    name: 'Igbo',
    nativeName: 'Asụsụ Igbo',
    region: 'Southeastern Nigeria / Ala Igbo',
    flag: '🇳🇬',
    welcomeGreeting: 'Nnọọ na EDENS AI! Abụ m ọkachamara gị na nlekọta ihe ọkụkụ. Jụọ m ajụjụ ọ bụla gbasara osisi na akwụkwọ nri gị.',
    sampleQuestions: [
      'Kedu ka m ga-esi chebe akwụkwọ nri m pụọ n\'ọrịa?',
      'Gịnị kpatara akwụkwọ tomato m ji ada ma ọ bụ chaa odo?',
      'Kedu ụzọ kacha mma isi nye osisi nri n\'oge ọkọchị?',
      'Kedu otu esi agwọ pests na-enweghị ọgwụ na-egbu egbu?'
    ],
    speechCode: 'ig-NG'
  },
  {
    id: 'yo',
    name: 'Yoruba',
    nativeName: 'Èdè Yorùbá',
    region: 'Southwestern Nigeria / Ilẹ̀ Yorùbá',
    flag: '🇳🇬',
    welcomeGreeting: 'Ẹ kú àbọ̀ sí EDENS AI! Èmi ni onímọ̀ nípa àwọn ohun ọ̀gbìn àti irèko. Ẹ béèrè ìbéèrè èyíkéyìí nípa àwọn ohun ọ̀gbìn yín.',
    sampleQuestions: [
      'Báwo ni mo ṣe lè tọ́jú ewé tó ń gbẹ tàbí tó ń yí sí pọ́n?',
      'Kí ni oògùn àdánidá tó dára jù fún kòkòrò lórí tòmátì?',
      'Báwo ni omi àti ooru ṣe yẹ kí ó rí nínú greenhouse mi?',
      'Àwọn àmì wo ni ó ń fi hàn pé irúgbìn mi fẹ́ oúnjẹ ilẹ̀?'
    ],
    speechCode: 'yo-NG'
  },
  {
    id: 'pcm',
    name: 'Nigerian Pidgin',
    nativeName: 'Naija Pidgin',
    region: 'Pan-Nigerian / All Regions',
    flag: '🇳🇬',
    welcomeGreeting: 'How far! Welcome to EDENS AI. I be your master farmer & plant doctor. Wetin dey worry your crops? Ask me anything!',
    sampleQuestions: [
      'My tomato leaf dey turn yellow, wetin cause am and how I fit fix am?',
      'Which natural remedy fit chase insects comot for my vegetable without chemical?',
      'How I go know say my soil get enough water and moisture?',
      'How long e go take before my pepper and ugwu ready for harvest?'
    ],
    speechCode: 'en-NG'
  },
  {
    id: 'ff',
    name: 'Fulfulde',
    nativeName: 'Fulfulde / Pulaar',
    region: 'Northern & Middle Belt Nigeria',
    flag: '🇳🇬',
    welcomeGreeting: 'Jam koodume e EDENS AI! Miɗo anndi no ngaynaaka e remru ndunngu wayi. Ƴamɗam ko faati e gese maa.',
    sampleQuestions: [
      'Noy mbaawrumi reende leɗɗe am e ɗowri e nyaw?',
      'Ko waɗi haakooji ɗin ina ndoolo?',
      'Noy ndiyam foti hewde e nder galle leɗɗe (greenhouse)?'
    ],
    speechCode: 'ff-NG'
  },
  {
    id: 'tiv',
    name: 'Tiv',
    nativeName: 'Zwa Tiv',
    region: 'Benue State (Food Basket of the Nation)',
    flag: '🇳🇬',
    welcomeGreeting: 'M sugh u van hen EDENS AI! M ngu orfan kwagh u ihyande man ikyon. Pinem kwagh u ikyon you cii.',
    sampleQuestions: [
      'Me er nan ve ihyande yam ia lu a mzehe gbem?',
      'Ka nyi i lu kahan kpughur liam sha ikyon yam?',
      'Me nongo nan man m sugh mngerem sha gbashima hen ajiir ne?'
    ],
    speechCode: 'en-NG'
  },
  {
    id: 'efi',
    name: 'Efik / Ibibio',
    nativeName: 'Usem Efik',
    region: 'South-South (Cross River & Akwa Ibom)',
    flag: '🇳🇬',
    welcomeGreeting: 'Mme kom fi ke EDENS AI! Ami ndi andikpep n̄kpọ emi aban̄ade eto ye mfut. Bip mi se ekededi emi ọfịnade fi.',
    sampleQuestions: [
      'Nso idinam mbiet mi etie nte ekpa un̄wọñ?',
      'Didie ke n̄kpan mme n̄kukuñkpọ ke mbiet mi ye unana ibọk?',
      'Mmon̄ akpana ekem didie ke ufọk mfut emi?'
    ],
    speechCode: 'en-NG'
  },
  {
    id: 'en',
    name: 'English',
    nativeName: 'English (Nigeria)',
    region: 'Official / All Regions',
    flag: '🌐',
    welcomeGreeting: 'Welcome to EDENS AI, powered by RA. I am your specialized agronomist and greenhouse diagnostic expert. How can I assist your crop management today?',
    sampleQuestions: [
      'How do I treat fungal leaf spots organically?',
      'What are the optimal greenhouse climate parameters for tomatoes?',
      'How does humidity level affect blossom end rot?',
      'What soil moisture percentage ensures maximum yield?'
    ],
    speechCode: 'en-GB'
  }
];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  languageId?: string;
  isVoiceInput?: boolean;
  audioUrl?: string;
  audioBase64?: string;
  voiceName?: string;
}

function buildAiRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = sessionStorage.getItem('edens_session_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

function getActiveGreenhouseIdForAi(dataSource?: string): string | undefined {
  if (dataSource === 'SIMULATED') return undefined;
  try {
    const id = sessionStorage.getItem('edens_active_greenhouse_id');
    return id || undefined;
  } catch {
    return undefined;
  }
}

export async function predictHarvest(
  cropType: string,
  plantingDate: string,
  standardDays: number,
  avgTemp: number,
  avgHumidity: number,
  lightHours: number,
  soilMoisture: number
): Promise<HarvestPredictionResult> {
  const greenhouseId = getActiveGreenhouseIdForAi();
  const res = await fetch('/api/ai/predict-harvest', {
    method: 'POST',
    headers: buildAiRequestHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      greenhouseId,
      cropType,
      plantingDate,
      standardDays,
      avgTemp,
      avgHumidity,
      lightHours,
      soilMoisture
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.result) {
    throw new Error(data?.message || `Harvest prediction failed with HTTP ${res.status}`);
  }
  return data.result as HarvestPredictionResult;
}

export class CameraDiagnosisError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly ageSeconds?: number;
  public readonly frameTimestamp?: string;

  constructor(message: string, code: string, status: number, ageSeconds?: number, frameTimestamp?: string) {
    super(message);
    this.name = 'CameraDiagnosisError';
    this.code = code;
    this.status = status;
    this.ageSeconds = ageSeconds;
    this.frameTimestamp = frameTimestamp;
  }
}

/**
 * Diagnoses the latest genuine, fresh ESP32-CAM photograph stored on the server.
 * Refuses simulated, missing (404), or stale/cached (409) images so old snapshots
 * are never treated as live physical camera captures.
 */
export async function diagnoseLatestCameraFrame(
  languageId: string = 'ha'
): Promise<PlantAnalysisResult> {
  const greenhouseId = getActiveGreenhouseIdForAi();
  const res = await fetch('/api/ai/diagnose', {
    method: 'POST',
    headers: buildAiRequestHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      greenhouseId,
      useLatestCameraFrame: true,
      requireFresh: true,
      languageId
    })
  });

  if (res.ok) {
    const data = await res.json();
    if (data.result) return data.result as PlantAnalysisResult;
    throw new Error('Diagnosis response missing result data.');
  }

  const errJson = await res.json().catch(() => ({}));
  throw new CameraDiagnosisError(
    errJson.message || `Camera plant diagnosis failed with HTTP ${res.status}`,
    errJson.error || 'DIAGNOSIS_FAILED',
    res.status,
    errJson.ageSeconds,
    errJson.timestamp
  );
}

export async function analyzePlantImage(
  base64Image: string,
  languageId: string = 'pcm'
): Promise<PlantAnalysisResult> {
  const res = await fetch('/api/ai/diagnose', {
    method: 'POST',
    headers: buildAiRequestHeaders(),
    credentials: 'include',
    body: JSON.stringify({ image: base64Image, source: 'MANUAL_UPLOAD', languageId })
  });

  if (res.ok) {
    const data = await res.json();
    if (data.result) return data.result as PlantAnalysisResult;
    throw new Error('Diagnosis response missing result data');
  }

  const errJson = await res.json().catch(() => ({}));
  if (res.status === 503) {
    throw new Error(
      errJson.message ||
        'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in your Render dashboard.'
    );
  }
  throw new Error(errJson.message || `Plant diagnosis failed with HTTP ${res.status}`);
}

export async function transcribeSpeechAudio(
  base64Audio: string,
  mimeType: string = 'audio/webm',
  languageId: string = 'ha'
): Promise<string> {
  const res = await fetch('/api/ai/transcribe', {
    method: 'POST',
    headers: buildAiRequestHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      audio: base64Audio,
      mimeType,
      languageId
    })
  });

  if (!res.ok) {
    let errorMsg = `Server returned HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorMsg = errJson.message || errJson.error || errorMsg;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  const data = await res.json();
  return data.transcript || '';
}

export async function generateSpeechAudio(
  text: string,
  voiceName: string = 'Kore',
  _styleDescription: string = 'Warm, respectful, articulate African agronomist expert'
): Promise<string> {
  const res = await fetch('/api/ai/speech', {
    method: 'POST',
    headers: buildAiRequestHeaders(),
    credentials: 'include',
    body: JSON.stringify({ text, voiceName })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.pcmBase64) {
    throw new Error(data?.message || `Speech synthesis failed with HTTP ${res.status}`);
  }
  return data.pcmBase64 as string;
}

export async function evaluateAgentDecision<T = any>(
  agentType: 'climate' | 'irrigation',
  telemetry: Record<string, any>
): Promise<T> {
  const greenhouseId = getActiveGreenhouseIdForAi(telemetry?.dataSource);
  const res = await fetch('/api/ai/agent-decision', {
    method: 'POST',
    headers: buildAiRequestHeaders(),
    credentials: 'include',
    body: JSON.stringify({ greenhouseId, agentType, telemetry })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.result) {
    throw new Error(data?.message || `Agent decision failed with HTTP ${res.status}`);
  }
  return data.result as T;
}

/**
 * Local Agronomist Knowledge Base fallback ONLY when the backend /api/ai/chat route
 * is unreachable or encounters an upstream error; always explicitly labelled.
 */
function getLocalAgronomistFallback(
  message: string,
  languageId: string,
  cropType?: string
): string {
  const m = message.toLowerCase().trim();
  const crop = cropType || 'greenhouse crops';

  if (m === 'hi' || m === 'hello' || m === 'hey' || m.startsWith('hi ') || m.startsWith('hello ') || m === 'sannu' || m === 'ekaro' || m === 'ndewo' || m.includes('how far')) {
    if (languageId === 'ha') {
      return `Sannu manomi! Ni ne masanin shuke-shuken EDENS AI, tare da haɗin gwiwar RA. Zan iya taimaka maka da yanayin zafin greenhouse, ruwa, da maganin cututtuka.`;
    }
    if (languageId === 'yo') {
      return `Ẹ ǹlẹ́ o àgbẹ̀! Èmi ni onímọ̀ EDENS AI, pẹ̀lú agbára RA. Mo wà níbí láti ràn ọ́ lọ́wọ́ pẹ̀lú omi, ooru, àti àtọ́jú ilẹ̀.`;
    }
    if (languageId === 'ig') {
      return `Nnọọ ezigbo onye ọrụ ugbo! Abụ m ọkachamara EDENS AI, site na nkwado RA. Enwere m ike inyere gị aka na nlekọta mmiri, okpomọkụ, na ọgwụgwọ ọrịa osisi.`;
    }
    if (languageId === 'pcm') {
      return `How far my master farmer! Welcome to EDENS AI, powered by RA. Wetin you wan ask me about watering, pest control, or greenhouse heat today?`;
    }
    return `Hello farmer! Welcome to EDENS AI, powered by RA. You can ask me about watering schedules, pest defense, climate tuning, or visual diagnosis.`;
  }

  if (m.includes('yellow') || m.includes('leaf') || m.includes('leaves') || m.includes('chlorosis') || m.includes('rawa') || m.includes('gbẹ')) {
    if (languageId === 'pcm') {
      return `Yellow leaf fit happen because of three main reasons for greenhouse: 1) Too much water wey dey choke the roots, 2) Nitrogen hunger, or 3) Early fungal blight. Make you check your soil moisture first — aim for 50-60%.`;
    }
    if (languageId === 'ha') {
      return `Ganyen da ke zama rawaya yakan faru ne saboda yawan ruwa da ke shake jijiyoyin shuka, ko rashin sinadarin Nitrogen, ko cutar fungal. Fara duba ma'aunin ruwan ƙasa (50-60%).`;
    }
    return `Yellowing foliage (chlorosis) in greenhouse ${crop} is commonly caused by root-zone waterlogging or nitrogen deficiency. Verify soil moisture is within 50–65% and ensure drainage is clear.`;
  }

  if (m.includes('pest') || m.includes('insect') || m.includes('aphid') || m.includes('whitefly') || m.includes('mite') || m.includes('worm') || m.includes('kwari') || m.includes('kòkòrò')) {
    if (languageId === 'pcm') {
      return `For organic pest control without chemical: 1) Boil fresh Dongoyaro (Neem) leaves, cool the extract, mix small mild soap, and spray under the leaves in the evening. 2) Use yellow sticky traps for whiteflies.`;
    }
    if (languageId === 'ha') {
      return `Hanyar magance kwari ba tare da sinadarai masu guba ba: Tafasa ganyen Dogon Yaro (Neem), a bar shi ya huce, a fesa a ƙarƙashin ganye da yamma, sannan a kafa tarkon kwari mai launin rawaya.`;
    }
    return `For non-toxic greenhouse pest management: 1) Apply cooled Neem leaf (Dongoyaro) extract with 0.1% potassium soap under leaves at dusk. 2) Install yellow sticky traps for whiteflies.`;
  }

  if (m.includes('water') || m.includes('irrigation') || m.includes('moisture') || m.includes('dry') || m.includes('ruwa') || m.includes('omi') || m.includes('mmiri')) {
    if (languageId === 'pcm') {
      return `Watering rule for greenhouse: Early morning (6:30am – 8:30am) na the best time. Keep soil moisture between 50% and 65% and avoid wetting leaves in hot sun.`;
    }
    return `Optimal irrigation for greenhouse ${crop}: Irrigate between 06:30 and 08:30, targeting 50%–65% soil moisture at the root zone.`;
  }

  if (m.includes('temp') || m.includes('heat') || m.includes('hot') || m.includes('cold') || m.includes('ventil') || m.includes('fan') || m.includes('zafi') || m.includes('ooru')) {
    if (languageId === 'pcm') {
      return `For greenhouse, keep temperature between 22°C and 28°C. Once e pass 30°C, open roof vents and run circulation fans so flowers no go drop.`;
    }
    return `Greenhouse thermal guidance: Maintain canopy temperature between 22°C and 28°C; ventilate above 30°C to prevent blossom drop.`;
  }

  if (m === 'go on' || m === 'continue' || m === 'next' || m === 'more' || m.startsWith('go on') || m.startsWith('continue')) {
    return `Continuing offline advisory for ${crop}: 1) Verify morning drip watering maintains 50–65% soil moisture, 2) Ensure ventilation keeps canopy below 28°C, and 3) Inspect lower leaves for early pest or fungal spots.`;
  }

  return `Offline agronomic guidance for ${crop}: Maintain canopy temperature within 22°C–28°C and soil moisture between 50% and 65%. Retry shortly once live Gemini AI connectivity resumes.`;
}

export async function consultAgronomist(
  message: string,
  languageId: string = 'pcm',
  history: ChatMessage[] = [],
  contextData?: {
    cropType?: string;
    temperature?: number;
    humidity?: number;
    soilMoisture?: number;
    dataSource?: string;
    isStale?: boolean;
    lastSeen?: string;
  }
): Promise<string> {
  try {
    const greenhouseId = getActiveGreenhouseIdForAi(contextData?.dataSource);
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: buildAiRequestHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        greenhouseId,
        message,
        languageId,
        history,
        contextData
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.reply) return data.reply;
      throw new Error('Empty reply from AI consultation endpoint.');
    }

    const errJson = await res.json().catch(() => ({}));
    if (res.status === 503) {
      throw new Error(
        errJson.message ||
          'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in your Render dashboard environment variables.'
      );
    }
    throw new Error(errJson.message || `AI consultation failed with HTTP ${res.status}`);
  } catch (fetchErr: any) {
    if (
      fetchErr.message &&
      (fetchErr.message.includes('GEMINI_API_KEY') ||
        fetchErr.message.includes('Render') ||
        fetchErr.message.includes('unconfigured'))
    ) {
      throw fetchErr;
    }
    console.warn('Backend chat endpoint error, returning explicitly labelled offline advisory:', fetchErr.message);
    const fallbackText = getLocalAgronomistFallback(message, languageId, contextData?.cropType);
    return `[Offline Knowledge Base Advisory — Live Gemini AI Unavailable: ${fetchErr.message || 'Network error'}]\n\n${fallbackText}`;
  }
}
