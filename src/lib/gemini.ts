import { GoogleGenAI, Type } from "@google/genai";

export function getGeminiApiKey(): string {
  const envKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
                 (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) ||
                 '';
  if (envKey && envKey !== 'MY_GEMINI_API_KEY') return envKey;
  return '';
}

export function getAi(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: getGeminiApiKey(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

const ai = getAi();

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

export async function predictHarvest(
  cropType: string,
  plantingDate: string,
  standardDays: number,
  avgTemp: number,
  avgHumidity: number,
  lightHours: number,
  soilMoisture: number
): Promise<HarvestPredictionResult> {
  const textPart = {
    text: `You are an expert agronomist and greenhouse scientist in EDENS AI (powered by RA). Based on the following real-time growing conditions, calculate the estimated harvest date for ${cropType} planted on ${plantingDate}. 
Standard growing period: ${standardDays} days. 
Current conditions: Average temp: ${avgTemp}°C, Humidity stability: ${avgHumidity}%, Light hours/day: ${lightHours}h, Soil moisture stability: ${soilMoisture}%. 
Ideal conditions: Temp 22-26°C, Humidity 60-70%, Light 14-16h/day, Moisture stable at 40-60%. 
Calculate how much faster (or slower) the crop will mature compared to standard outdoor growing. Return JSON.`,
  };

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: { parts: [textPart] },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          estimatedDaysTotal: { type: Type.INTEGER, description: "Total estimated growing days" },
          daysSaved: { type: Type.INTEGER, description: "Days saved compared to standard" },
          daysRemaining: { type: Type.INTEGER, description: "Calculated days remaining from today" },
          estimatedHarvestDate: { type: Type.STRING, description: "YYYY-MM-DD string" },
          confidence: { type: Type.INTEGER, description: "Confidence score 0-100" },
          factors: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                impact: { type: Type.INTEGER, description: "Number of days impacted (+ or -)" },
                explanation: { type: Type.STRING }
              },
              required: ["name", "impact", "explanation"]
            }
          }
        },
        required: ["estimatedDaysTotal", "daysSaved", "daysRemaining", "estimatedHarvestDate", "confidence", "factors"],
      },
    },
  });

  if (!response.text) {
    throw new Error("No text returned from Gemini");
  }

  return JSON.parse(response.text.trim()) as HarvestPredictionResult;
}

export async function analyzePlantImage(
  base64Image: string,
  languageId: string = 'pcm'
): Promise<PlantAnalysisResult> {
  const isBrowser = typeof window !== 'undefined' && typeof window.fetch === 'function';
  if (isBrowser) {
    try {
      const res = await fetch('/api/ai/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, languageId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result) return data.result;
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 503) {
          throw new Error(errJson.message || 'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in your Render dashboard.');
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('GEMINI_API_KEY')) throw err;
      console.warn("Backend /api/ai/diagnose note, attempting client fallback:", err.message);
    }
  }

  const selectedLang = NIGERIAN_LANGUAGES.find(l => l.id === languageId) || NIGERIAN_LANGUAGES[0];

  let mimeType = 'image/jpeg';
  let cleanData = base64Image.trim();

  if (cleanData.startsWith('data:')) {
    const match = cleanData.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const detected = match[1].toLowerCase();
      mimeType = (detected === 'image/png' || detected === 'image/webp') ? detected : 'image/jpeg';
      cleanData = match[2];
    }
  } else {
    cleanData = cleanData.replace(/^data:image\/\w+;base64,/, "");
  }

  const imagePart = {
    inlineData: {
      mimeType,
      data: cleanData,
    },
  };

  const promptText = `You are EDENS AI, an elite plant health expert and agronomist for Nigerian and tropical greenhouse farming, powered by RA.
Analyze this plant leaf/crop image carefully.

CRITICAL REQUIREMENT:
The user selected the language: "${selectedLang.name} (${selectedLang.nativeName}) - ${selectedLang.region}".
Communicate the diagnosis, visible symptoms, likely cause, and recommendations fluently and naturally in ${selectedLang.name} (${selectedLang.nativeName}), suitable for farmers in Nigeria.
If Nigerian Pidgin is selected, use authentic, friendly Naija Pidgin (e.g., 'Your tomato plant get small yellow leaf stress, no panic, give am water and reduce heat').
If Hausa is selected, use authentic Harshen Hausa with accurate farming terms (e.g., 'Shukar tumatir tana fama da ƙwayoyin cuta na ganye...').
If Yoruba is selected, use authentic Èdè Yorùbá (e.g., 'Àwọn ewé tòmátì yìí ń fi àmì àrùn hàn nítorí ọ̀rinrin tó pọ̀jù...').
If Igbo is selected, use authentic Asụsụ Igbo (e.g., 'Akwụkwọ nri tomato gị na-ata ahụhụ site na nsogbu ọrịa fungal...').
For other Nigerian native tongues (Fulfulde, Tiv, Efik), communicate accurately in that tongue.

In the JSON response:
- 'species': Scientific or common English name with local Nigerian name (e.g., "Tomato (Tumatir / Tòmátì)").
- 'speciesLocal': The name solely in ${selectedLang.name}.
- 'healthStatus': One of: "Healthy", "Stressed", "Diseased".
- 'healthStatusLocal': Translated status in ${selectedLang.name} (e.g., Hausa: "Lafiyayye" or "Mai Ciwo"; Igbo: "Ahụ dị mma" or "Na-arịa ọrịa"; Yoruba: "Ni Ilera" or "Ní Àrùn"; Pidgin: "Dey Healthy Well-Well" or "Dey Suffer Sickness").
- 'symptoms': Detailed visible symptoms written in ${selectedLang.name}.
- 'cause': Root cause explanation written in ${selectedLang.name}.
- 'recommendation': Actionable, practical steps in ${selectedLang.name} (include organic/local Nigerian remedies like neem leaf/dongoyaro water, wood ash, proper spacing, drip watering where appropriate).
- 'audioSummary': A short, clear 1-2 sentence spoken summary written in ${selectedLang.name} for audio read-aloud.`;

  const textPart = { text: promptText };

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: { parts: [imagePart, textPart] },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          species: { type: Type.STRING, description: "Common name with local name" },
          speciesLocal: { type: Type.STRING, description: `Plant name in ${selectedLang.name}` },
          healthStatus: { type: Type.STRING, description: "Healthy, Stressed, or Diseased" },
          healthStatusLocal: { type: Type.STRING, description: `Health status in ${selectedLang.name}` },
          symptoms: { type: Type.STRING, description: `Visible symptoms in ${selectedLang.name}` },
          cause: { type: Type.STRING, description: `Likely cause in ${selectedLang.name}` },
          recommendation: { type: Type.STRING, description: `Recommended actions in ${selectedLang.name}` },
          audioSummary: { type: Type.STRING, description: `Spoken summary in ${selectedLang.name}` },
        },
        required: ["species", "healthStatus", "symptoms", "cause", "recommendation"],
      },
    },
  });

  if (!response.text) {
    throw new Error("No text returned from Gemini");
  }

  const parsed = JSON.parse(response.text.trim()) as PlantAnalysisResult;
  parsed.language = selectedLang.name;
  return parsed;
}

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

export async function transcribeSpeechAudio(
  base64Audio: string,
  mimeType: string = 'audio/webm',
  languageId: string = 'ha'
): Promise<string> {
  const isBrowser = typeof window !== 'undefined' && typeof window.fetch === 'function';

  if (isBrowser) {
    const res = await fetch('/api/ai/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  // Node.js direct SDK execution (for backend tests or server side)
  const selectedLang = NIGERIAN_LANGUAGES.find(l => l.id === languageId) || NIGERIAN_LANGUAGES[0];

  const audioPart = {
    inlineData: {
      mimeType: mimeType || 'audio/webm',
      data: base64Audio.replace(/^data:audio\/\w+;base64,/, ''),
    },
  };

  const instructionText = `You are an elite speech-to-text AI transcriber and linguist for Nigerian indigenous languages and local dialects.
The farmer is speaking into the microphone in: ${selectedLang.name} (${selectedLang.nativeName}) or English/Nigerian Pidgin.
Listen carefully to the audio and transcribe the exact words spoken into clear, authentic text.
- If they speak Hausa, transcribe in Hausa (Harshen Hausa).
- If they speak Yoruba, transcribe in Yoruba (Èdè Yorùbá) with proper diacritics where appropriate.
- If they speak Igbo, transcribe in Igbo (Asụsụ Igbo).
- If they speak Nigerian Pidgin, transcribe in authentic Naija Pidgin.
- If they speak Fulfulde, Tiv, Efik, or Nigerian English, transcribe accurately.
Return ONLY the exact transcribed words as plain text. Do not provide translation, analysis, quotation marks, or meta text.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          audioPart,
          { text: instructionText }
        ],
      },
    });

    const text = response.text?.trim();
    if (text) return text;
  } catch (err) {
    console.warn("gemini-3.5-transcribe failed or unavailable, falling back to gemini-3.8-flash:", err);
  }

  // Fallback to gemini-3.8-flash which natively accepts audio inlineData
  const fallbackResponse = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: {
      parts: [
        audioPart,
        { text: instructionText }
      ],
    },
  });

  return fallbackResponse.text?.trim() || "";
}

export async function generateSpeechAudio(
  text: string,
  voiceName: string = 'Kore',
  styleDescription: string = 'Warm, respectful, articulate African agronomist expert'
): Promise<string> {
  const isBrowser = typeof window !== 'undefined' && typeof window.fetch === 'function';

  if (isBrowser) {
    try {
      const res = await fetch('/api/ai/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceName })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pcmBase64) return data.pcmBase64;
      }
    } catch (e: any) {
      console.warn("Backend speech API warning, falling back to direct/browser TTS:", e.message);
    }
  }

  const cleanText = text
    .replace(/[*#_`>~]/g, '')
    .replace(/\[.*?\]/g, '')
    .trim()
    .slice(0, 900); // optimal length for crisp TTS delivery

  if (!cleanText) {
    throw new Error("No text provided for speech generation");
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash-lite-tts",
    contents: cleanText,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName || "Kore" },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("No audio returned from Gemini TTS");
  }
  return base64Audio;
}

/**
 * Local Agronomist Knowledge Base fallback for when offline, during network
 * interruptions, or when Gemini API key is not yet provisioned in production.
 */
function getLocalAgronomistFallback(
  message: string,
  languageId: string,
  cropType?: string,
  errDetails?: string
): string {
  const m = message.toLowerCase().trim();
  const crop = cropType || 'greenhouse crops';
  const hasKeyIssue = Boolean(errDetails && (
    errDetails.toLowerCase().includes('api key') ||
    errDetails.toLowerCase().includes('api_key') ||
    errDetails.toLowerCase().includes('unauthenticated') ||
    errDetails.toLowerCase().includes('forbidden')
  ));

  let reply = '';

  // 1. Greetings
  if (m === 'hi' || m === 'hello' || m === 'hey' || m.startsWith('hi ') || m.startsWith('hello ') || m === 'sannu' || m === 'ekaro' || m === 'ndewo' || m.includes('how far')) {
    if (languageId === 'ha') {
      reply = `Sannu manomi! Ni ne masanin shuke-shuken EDENS AI, tare da haɗin gwiwar RA. Yaya ${crop} ɗinka ke ciki a yau? Zan iya taimaka maka da yanayin zafin greenhouse, ruwa, da maganin cututtuka.`;
    } else if (languageId === 'yo') {
      reply = `Ẹ ǹlẹ́ o àgbẹ̀! Èmi ni onímọ̀ EDENS AI, pẹ̀lú agbára RA. Báwo ni àwọn irúgbìn ${crop} rẹ ṣe ń ṣe lónìí? Mo wà níbí láti ràn ọ́ lọ́wọ́ pẹ̀lú omi, ooru, àti àtọ́jú ilẹ̀.`;
    } else if (languageId === 'ig') {
      reply = `Nnọọ ezigbo onye ọrụ ugbo! Abụ m ọkachamara EDENS AI, site na nkwado RA. Kedu ka ${crop} gị si na-eme taa? Enwere m ike inyere gị aka na nlekọta mmiri, okpomọkụ, na ọgwụgwọ ọrịa osisi.`;
    } else if (languageId === 'pcm') {
      reply = `How far my master farmer! Welcome to EDENS AI, powered by RA. I dey monitor your ${crop} well-well. Wetin you wan ask me about watering, pest control, or greenhouse heat today?`;
    } else {
      reply = `Hello farmer! Welcome to EDENS AI, powered by RA. Your greenhouse monitoring is active. How are your ${crop} performing today? You can ask me about watering schedules, pest defense, climate tuning, or visual diagnosis.`;
    }
  }
  // 2. Yellowing leaves / chlorosis
  else if (m.includes('yellow') || m.includes('leaf') || m.includes('leaves') || m.includes('chlorosis') || m.includes('rawa') || m.includes('gbẹ')) {
    if (languageId === 'pcm') {
      reply = `Yellow leaf fit happen because of three main reasons for greenhouse: 1) Too much water wey dey choke the roots, 2) Nitrogen hunger, or 3) Early fungal blight. Make you check your soil moisture first — aim for 50-60%. If soil dey too wet, reduce pumping for 24 hours. If moisture dey normal, add compost tea or organic nitrogen booster.`;
    } else if (languageId === 'ha') {
      reply = `Ganyen da ke zama rawaya yakan faru ne saboda yawan ruwa da ke shake jijiyoyin shuka, ko rashin sinadarin Nitrogen, ko cutar fungal. Fara duba ma'aunin ruwan ƙasa (ya kasance tsakanin 50-60%). Idan ƙasa ta yi laushi da yawa, dakatar da ban-ruwa na ɗan lokaci.`;
    } else {
      reply = `Yellowing foliage (chlorosis) in greenhouse ${crop} is most commonly caused by root zone waterlogging or nitrogen deficiency. 1) Verify soil moisture is within 50–65%. 2) Ensure container drainage is unobstructed. 3) Apply a balanced organic fertilizer or foliar spray to rapidly restore chlorophyll vigor.`;
    }
  }
  // 3. Pest / insect control
  else if (m.includes('pest') || m.includes('insect') || m.includes('aphid') || m.includes('whitefly') || m.includes('mite') || m.includes('worm') || m.includes('kwari') || m.includes('kòkòrò')) {
    if (languageId === 'pcm') {
      reply = `For organic pest control without chemical: 1) Boil fresh Dongoyaro (Neem) leaves, leave the water make e cool, mix am with small black soap or liquid detergent, spray under the leaves in the cool evening. 2) Put yellow sticky traps around the greenhouse for whiteflies. 3) Dust small wood ash for the stem base.`;
    } else if (languageId === 'ha') {
      reply = `Hanyar magance kwari ba tare da sinadarai masu guba ba: 1) Tafasa ganyen Dogon Yaro (Neem), a bar shi ya huce, a gauraya da ɗan sabulu marar zafi, a fesa a ƙarƙashin ganye da yamma. 2) A kafa tarkon kwari mai launin rawaya.`;
    } else {
      reply = `For safe, non-toxic greenhouse pest management: 1) Prepare Neem leaf (Dongoyaro) cold-pressed aqueous extract with 0.1% potassium soap as a surfactant; spray the undersides of leaves during early morning or sunset. 2) Install yellow and blue chromatic sticky traps for whiteflies and thrips. 3) Dust horticultural wood ash around container bases to deter crawling larvae.`;
    }
  }
  // 4. Watering & irrigation
  else if (m.includes('water') || m.includes('irrigation') || m.includes('moisture') || m.includes('dry') || m.includes('ruwa') || m.includes('omi') || m.includes('mmiri')) {
    if (languageId === 'pcm') {
      reply = `Watering rule for greenhouse: Early morning (6:30am – 8:30am) na the best time so the root go take water before afternoon heat. Keep soil moisture between 50% and 65%. Never spray water directly on the leaves when sun dey hot to prevent fungus and leaf burn.`;
    } else {
      reply = `Optimal irrigation for greenhouse ${crop}: Irrigate during early morning hours (06:30 – 08:30) to establish hydraulic turgor before peak transpiration. Target soil moisture between 50% and 65%. Avoid overhead spraying; use drip lines at the root collar to eliminate leaf surface humidity that breeds bacterial spot.`;
    }
  }
  // 5. Temperature and climate
  else if (m.includes('temp') || m.includes('heat') || m.includes('hot') || m.includes('cold') || m.includes('ventil') || m.includes('fan') || m.includes('zafi') || m.includes('ooru')) {
    if (languageId === 'pcm') {
      reply = `For greenhouse, keep temperature between 22°C and 28°C. Once e pass 30°C, flowers fit drop and tomato no go set fruit. Make you open the roof vents, turn on circulation fan, and use 50% shade net if sun too harsh.`;
    } else {
      reply = `Greenhouse thermal management: Maintain ambient canopy temperature between 22°C and 28°C for optimal pollination and fruit set. When temperatures exceed 30°C, trigger automated roof vents and circulation fans to evacuate the hot ceiling layer and prevent flower blossom abortion.`;
    }
  }
  // 6. General Agricultural Guidance
  else {
    if (languageId === 'ha') {
      reply = `Masanin EDENS AI na kula da yanayin ${crop} ɗinka. Don samun kyakkyawan amfani, kula da daidaita ruwa, zafin daki, da kuma bincika ganyaye akai-akai don gano alamun cuta ko kwari da wuri.`;
    } else if (languageId === 'yo') {
      reply = `Onímọ̀ EDENS AI ń tọ́jú àwọn ohun ọ̀gbìn ${crop} rẹ. Láti rí ìkórè tó dára, rí i dájú pé omi àti ooru wà ní ìwọ̀ntúnwọ̀nsì, kí o sì máa ṣàyẹ̀wò àwọn ewé déédéé.`;
    } else if (languageId === 'ig') {
      reply = `Ọkachamara EDENS AI na-elekọta ${crop} gị. Maka ezigbo owuwe ihe ubi, debe oke mmiri na okpomọkụ n'ụzọ ziri ezi, na-enyochakwa akwụkwọ nri mgbe niile maka ọrịa ma ọ bụ ahụhụ.`;
    } else if (languageId === 'pcm') {
      reply = `EDENS AI agronomist dey here for your ${crop}! Make you keep your greenhouse between 22°C-28°C and soil moisture around 55%. Ask me any question about pests, fertilizer, or harvest!`;
    } else {
      reply = `As your EDENS AI agronomist, I recommend keeping your greenhouse ${crop} canopy within 22°C–28°C and soil moisture between 50% and 65%. Feel free to ask about specific symptoms, organic fertilizers, watering schedules, or pest control.`;
    }
  }

  // If running on Render without GEMINI_API_KEY injected, append a helpful note
  if (hasKeyIssue) {
    reply += `\n\n*(Tip: To enable live Gemini AI reasoning on Render, add \`GEMINI_API_KEY\` in your Render Dashboard → Environment Variables).*`;
  }

  return reply;
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
  }
): Promise<string> {
  const isBrowser = typeof window !== 'undefined' && typeof window.fetch === 'function';

  if (isBrowser) {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          languageId,
          history,
          contextData
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.reply) return data.reply;
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 503) {
          throw new Error(errJson.message || 'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in your Render dashboard environment variables.');
        }
        if (errJson.message) {
          throw new Error(errJson.message);
        }
      }
    } catch (fetchErr: any) {
      if (fetchErr.message && (fetchErr.message.includes('GEMINI_API_KEY') || fetchErr.message.includes('Render') || fetchErr.message.includes('unconfigured'))) {
        throw fetchErr;
      }
      console.warn("Backend chat endpoint note, falling back to local agronomist knowledge:", fetchErr.message);
      return getLocalAgronomistFallback(message, languageId, contextData?.cropType, fetchErr.message);
    }
  }

  // Node.js direct SDK execution
  const selectedLang = NIGERIAN_LANGUAGES.find(l => l.id === languageId) || NIGERIAN_LANGUAGES[0];

  const systemInstruction = `You are EDENS AI, an expert autonomous agricultural assistant and botanist for smart greenhouse farming in Nigeria and West Africa, powered by RA.
You have native, fluent fluency in all Nigerian languages: Hausa, Igbo, Yoruba, Nigerian Pidgin, Fulfulde, Tiv, Efik, and English.

The farmer wants to communicate with you in: ${selectedLang.name} (${selectedLang.nativeName}) [Region: ${selectedLang.region}].
ALWAYS reply directly, warmly, and thoroughly in ${selectedLang.name}.
If the user speaks in Nigerian Pidgin, respond in cheerful, knowledgeable Nigerian Pidgin.
If the user speaks in Hausa, respond in respectful, accurate Harshen Hausa.
If the user speaks in Yoruba, respond in respectful, rich Èdè Yorùbá.
If the user speaks in Igbo, respond in clear, supportive Asụsụ Igbo.
Provide practical advice with local Nigerian agricultural realities in mind: organic pest remedies (e.g. Dongoyaro/Neem extract, wood ash, garlic spray), soil care, watering schedules, greenhouse ventilation, solar power considerations, and market-ready crop health.

${contextData ? `Current Greenhouse telemetry context:
- Monitored Crop: ${contextData.cropType || 'Vegetables'}
- Temp: ${contextData.temperature ?? 24}°C
- Humidity: ${contextData.humidity ?? 65}%
- Soil Moisture: ${contextData.soilMoisture ?? 50}%` : ''}`;

  // Build conversational contents adhering strictly to Gemini's multi-turn requirements:
  // 1. The first turn MUST have role 'user' (Gemini rejects conversations starting with 'model')
  // 2. Turns must alternate strictly between 'user' and 'model'
  const validHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  let expectedRole: 'user' | 'model' = 'user';

  for (const item of history) {
    if (!item.content || !item.content.trim()) continue;
    const itemRole: 'user' | 'model' = item.role === 'assistant' ? 'model' : 'user';

    // Gemini requires the first turn in contents to be 'user'
    if (validHistory.length === 0 && itemRole !== 'user') {
      continue;
    }

    if (itemRole === expectedRole) {
      validHistory.push({
        role: itemRole,
        parts: [{ text: item.content }]
      });
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    }
  }

  // If the last history turn is 'user', remove it so appending userTurn will not cause two consecutive user turns
  if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
    validHistory.pop();
  }

  const slicedHistory = validHistory.slice(-6);

  const userTurn = {
    role: 'user' as const,
    parts: [{ text: `[Speaking in ${selectedLang.name}]: ${message}` }]
  };

  const contents = [...slicedHistory, userTurn];

  try {
    const client = getAi();
    const response = await client.models.generateContent({
      model: "gemini-3.8-flash",
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 800,
      }
    });

    if (response.text?.trim()) {
      return response.text.trim();
    }
  } catch (err: any) {
    console.warn("Gemini consultAgronomist warning:", err.message);
    return getLocalAgronomistFallback(message, languageId, contextData?.cropType, err.message);
  }

  return getLocalAgronomistFallback(message, languageId, contextData?.cropType);
}

