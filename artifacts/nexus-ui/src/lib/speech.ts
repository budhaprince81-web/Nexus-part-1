/**
 * Pure helpers for text-to-speech.
 *
 * These are deliberately free of any DOM access so they can be unit tested in a
 * plain Node environment. The React hook in `hooks/use-voice.ts` is a thin
 * wrapper around them.
 */

/** Longest spoken chunk. Chrome truncates/stalls on very long utterances. */
export const MAX_SPEECH_CHUNK = 180;

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`([^`]+)`/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const HEADING = /^\s{0,3}#{1,6}\s+/gm;
const EMPHASIS = /(\*\*|__|\*|_|~~)/g;
const BLOCKQUOTE = /^\s{0,3}>\s?/gm;
const HORIZONTAL_RULE = /^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm;

/** Characters used as sentence terminators, including Devanagari danda. */
const SENTENCE_BREAK = /(?<=[.!?।\u0964\u0965])\s+/;
const CLAUSE_BREAK = /(?<=[,;:—–])\s+/;

/**
 * Turns Markdown into something worth hearing.
 *
 * Prose is never dropped: code blocks, links and URLs are replaced with a short
 * spoken marker rather than deleted, so the listener always knows something was
 * there. This is a deliberate transformation, not truncation.
 */
export function cleanForSpeech(input: string): string {
  return input
    .replace(FENCED_CODE, ' (code block) ')
    .replace(INLINE_CODE, '$1')
    .replace(MARKDOWN_LINK, '$1')
    .replace(BARE_URL, ' (link) ')
    .replace(HEADING, '')
    .replace(BLOCKQUOTE, '')
    .replace(HORIZONTAL_RULE, '')
    .replace(EMPHASIS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hardSplit(text: string, maxLen: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (current.length === 0) {
      current = word;
    } else if (`${current} ${word}`.length <= maxLen) {
      current = `${current} ${word}`;
    } else {
      out.push(current);
      current = word;
    }
    // A single "word" longer than the limit (a long token, a base64 blob, a
    // Sanskrit compound): emit it whole rather than cutting it in half, so no
    // content is ever lost.
    while (current.length > maxLen) {
      out.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) out.push(current);
  return out;
}

function splitLongSentence(sentence: string, maxLen: number): string[] {
  const clauses = sentence.split(CLAUSE_BREAK);
  const out: string[] = [];
  let current = '';
  for (const clause of clauses) {
    const piece = clause.trim();
    if (!piece) continue;
    if (piece.length > maxLen) {
      if (current) {
        out.push(current);
        current = '';
      }
      out.push(...hardSplit(piece, maxLen));
    } else if (!current) {
      current = piece;
    } else if (`${current} ${piece}`.length <= maxLen) {
      current = `${current} ${piece}`;
    } else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Splits text into utterance-sized chunks at sentence boundaries.
 *
 * Nothing is dropped: every input character survives into exactly one chunk, so
 * a long answer is read in full instead of being cut off at an arbitrary
 * character count.
 */
export function splitForSpeech(input: string, maxLen: number = MAX_SPEECH_CHUNK): string[] {
  const text = input.trim();
  if (!text) return [];
  const limit = maxLen > 0 ? maxLen : MAX_SPEECH_CHUNK;

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const line of text.split(/\n+/)) {
    const paragraph = line.trim();
    if (!paragraph) continue;

    // A paragraph shorter than the limit is still merged with the previous one
    // when they fit together, which keeps the speech flowing naturally.
    for (const sentence of paragraph.split(SENTENCE_BREAK)) {
      const piece = sentence.trim();
      if (!piece) continue;
      if (piece.length > limit) {
        flush();
        chunks.push(...splitLongSentence(piece, limit));
        continue;
      }
      if (!current) {
        current = piece;
      } else if (`${current} ${piece}`.length <= limit) {
        current = `${current} ${piece}`;
      } else {
        flush();
        current = piece;
      }
    }
    flush();
  }

  flush();
  return chunks;
}

/** Short, recognised feminine voice names across the common platforms. */
const FEMININE_VOICE =
  /\b(female|woman|samantha|zira|aria|jenny|ava|sara|susan|karen|moira|tessa|neerja|heera|kalpana|swara)\b/i;

export interface VoiceSelection {
  /** The voice to use, or null to let the browser pick its default. */
  voice: SpeechSynthesisVoice | null;
  /** An exact BCP-47 match (e.g. `ne-NP`) existed. */
  exactMatch: boolean;
  /** At least one voice for the requested language existed. */
  languageAvailable: boolean;
}

interface VoiceLike {
  name: string;
  lang: string;
  default?: boolean;
}

function primaryLang(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Chooses the best available voice for `lang`.
 *
 * Exact locale match wins, then any voice of the same language, then nothing
 * (the browser default). `languageAvailable` is what callers use to tell the
 * user honestly that, for example, no Nepali voice is installed on this device.
 */
export function selectVoice(
  voices: ReadonlyArray<VoiceLike>,
  lang: string,
  preferFeminine = true,
): VoiceSelection {
  const normalized = lang.toLowerCase();
  const language = primaryLang(normalized);

  const exact = voices.filter((v) => v.lang.toLowerCase().replace(/_/g, '-') === normalized);
  const sameLanguage = voices.filter((v) => primaryLang(v.lang) === language);
  const pool = exact.length > 0 ? exact : sameLanguage;

  if (pool.length === 0) {
    return { voice: null, exactMatch: false, languageAvailable: false };
  }

  const preferred = preferFeminine ? pool.find((v) => FEMININE_VOICE.test(v.name)) : undefined;
  const chosen = preferred ?? pool.find((v) => v.default) ?? pool[0];

  return {
    voice: chosen as SpeechSynthesisVoice,
    exactMatch: exact.length > 0,
    languageAvailable: true,
  };
}

/** True when the device has at least one installed voice for `lang`. */
export function hasVoiceForLanguage(
  voices: ReadonlyArray<VoiceLike>,
  lang: string,
): boolean {
  const language = primaryLang(lang);
  return voices.some((v) => primaryLang(v.lang) === language);
}

/** Human label for a BCP-47 tag, for the settings screen. */
export function languageLabel(tag: string): string {
  const normalized = tag.trim();
  if (!normalized) return 'unknown';
  try {
    const [language, region] = normalized.replace(/_/g, '-').split('-');
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    const base = names.of(language) ?? language;
    return region ? `${base} (${region.toUpperCase()})` : base;
  } catch {
    return normalized;
  }
}
