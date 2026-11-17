/**
 * Email Translation Service via AI Proxy (OpenAI-compatible endpoint)
 * Uses lightweight/cheapest Gemini models (e.g. gemini-flash-lite) for high-speed email translations.
 */

export interface TranslationInput {
  subject?: string | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  targetLanguage?: string;
}

export interface TranslationResult {
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  detectedLanguage: string;
  isAlreadyEnglish: boolean;
  model: string;
}

const DEFAULT_AI_PROXY_URL = "https://aiproxy.itsata.com/v1";
const DEFAULT_AI_PROXY_TOKEN = "sk-cpa-atx-8e792fb14a5cd60321ea89f0714b2d9e";
const DEFAULT_MODEL = "gemini-flash-lite";

// In-memory LRU-like translation cache to prevent duplicate LLM calls
const translationCache = new Map<string, { result: TranslationResult; expiresAt: number }>();
const MAX_CACHE_SIZE = 250;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function getCacheKey(input: TranslationInput, targetLanguage: string): string {
  const s = input.subject || "";
  const h = (input.bodyHtml || "").slice(0, 500) + (input.bodyHtml || "").length;
  const t = (input.bodyText || "").slice(0, 500) + (input.bodyText || "").length;
  return `${targetLanguage}:::${s}:::${h}:::${t}`;
}

/**
 * Extracts heavy inline base64 images so they are not sent to the LLM.
 * Replaces them with placeholders and returns a restore function.
 */
function isolateDataUris(html: string): { sanitizedHtml: string; restore: (translatedHtml: string) => string } {
  const placeholders: string[] = [];
  const sanitizedHtml = html.replace(/src=["']data:image\/[^"']+["']/gi, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `src="__OMNI_IMG_PH_${idx}__"`;
  });

  const restore = (translatedHtml: string): string => {
    let restored = translatedHtml;
    placeholders.forEach((origMatch, idx) => {
      restored = restored.replaceAll(`__OMNI_IMG_PH_${idx}__`, origMatch.slice(5, -1)); // replace placeholder with data URI
    });
    return restored;
  };

  return { sanitizedHtml, restore };
}

/**
 * Safely parses JSON returned by LLM, handling markdown code fences.
 */
function parseLlmJson(rawContent: string): any {
  let cleaned = rawContent.trim();
  // Strip markdown ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  // If there is extra preamble or postamble, locate the outer {...}
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

export async function translateEmail(input: TranslationInput): Promise<TranslationResult> {
  const targetLanguage = input.targetLanguage?.trim() || "English";
  const cacheKey = getCacheKey(input, targetLanguage);

  // Check cache
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const rawSubject = (input.subject || "").trim();
  const rawHtml = input.bodyHtml || null;
  const rawText = input.bodyText || null;

  // Nothing to translate
  if (!rawSubject && !rawHtml && !rawText) {
    return {
      subject: "",
      bodyHtml: null,
      bodyText: null,
      detectedLanguage: "Unknown",
      isAlreadyEnglish: true,
      model: DEFAULT_MODEL,
    };
  }

  const aiProxyUrl = (process.env.AI_PROXY_URL || DEFAULT_AI_PROXY_URL).replace(/\/+$/, "");
  const aiProxyToken = process.env.AI_PROXY_TOKEN || DEFAULT_AI_PROXY_TOKEN;
  const model = process.env.AI_PROXY_MODEL || DEFAULT_MODEL;

  let processedHtml = rawHtml;
  let restoreHtmlImages: ((str: string) => string) | null = null;

  if (processedHtml) {
    const { sanitizedHtml, restore } = isolateDataUris(processedHtml);
    processedHtml = sanitizedHtml;
    restoreHtmlImages = restore;

    // Hard character guard to prevent token explosion on massive marketing emails
    if (processedHtml.length > 80000) {
      processedHtml = processedHtml.slice(0, 80000) + "... [content truncated for translation]";
    }
  }

  const systemPrompt = `You are an expert multilingual email translation engine.
Translate the provided email content into ${targetLanguage}.
Guidelines:
1. If "bodyHtml" is provided, translate ONLY the user-visible human language text. You MUST preserve all HTML tags, structure, classes, attributes, inline styles, and links (<a href="...">) exactly as they are.
2. If "bodyText" is provided, translate it preserving natural paragraphs, bullet lists, and line breaks.
3. Translate the "subject" line accurately.
4. If the email is already in ${targetLanguage}, return it unchanged and set "isAlreadyEnglish": true (or corresponding target language).
5. Detect the source language and set "detectedLanguage" (e.g. "French", "German", "Spanish", "Japanese", "Turkish", "English").
6. You must respond ONLY with a valid JSON object matching this schema:
{
  "subject": "string",
  "bodyHtml": "string or null",
  "bodyText": "string or null",
  "detectedLanguage": "string",
  "isAlreadyEnglish": boolean
}`;

  const payloadUserContent = JSON.stringify({
    subject: rawSubject,
    bodyHtml: processedHtml,
    bodyText: rawText ? (rawText.length > 50000 ? rawText.slice(0, 50000) : rawText) : null,
  });

  const endpoint = aiProxyUrl.endsWith("/chat/completions")
    ? aiProxyUrl
    : `${aiProxyUrl}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiProxyToken}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: payloadUserContent },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI translation request failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawAssistantContent = data.choices?.[0]?.message?.content;

  if (!rawAssistantContent) {
    throw new Error("AI translation service returned an empty response.");
  }

  let parsed: any;
  try {
    parsed = parseLlmJson(rawAssistantContent);
  } catch (err: any) {
    throw new Error(`Failed to parse AI translation output: ${err.message}. Raw: ${rawAssistantContent.slice(0, 200)}`);
  }

  let finalBodyHtml: string | null = parsed.bodyHtml || null;
  if (finalBodyHtml && restoreHtmlImages) {
    finalBodyHtml = restoreHtmlImages(finalBodyHtml);
  }

  const result: TranslationResult = {
    subject: parsed.subject || rawSubject,
    bodyHtml: finalBodyHtml || (parsed.bodyText ? null : rawHtml),
    bodyText: parsed.bodyText || null,
    detectedLanguage: parsed.detectedLanguage || "Unknown",
    isAlreadyEnglish: Boolean(parsed.isAlreadyEnglish),
    model,
  };

  // Add to cache
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) translationCache.delete(oldestKey);
  }
  translationCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}
