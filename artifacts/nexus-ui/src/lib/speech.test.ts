import { describe, expect, it } from 'vitest';
import {
  MAX_SPEECH_CHUNK,
  cleanForSpeech,
  hasVoiceForLanguage,
  languageLabel,
  selectVoice,
  splitForSpeech,
} from './speech';

describe('cleanForSpeech', () => {
  it('keeps prose intact so nothing the model said is lost', () => {
    expect(cleanForSpeech('The reactor is stable.')).toBe('The reactor is stable.');
  });

  it('replaces fenced code with a spoken marker instead of dropping the sentence', () => {
    const spoken = cleanForSpeech('Here is the fix:\n```js\nconst a = 1;\n```\nIt works now.');
    expect(spoken).toContain('Here is the fix:');
    expect(spoken).toContain('(code block)');
    expect(spoken).toContain('It works now.');
    expect(spoken).not.toContain('const a = 1');
  });

  it('strips markdown markers but keeps the words', () => {
    const spoken = cleanForSpeech('# Heading\n\n**bold** and _italic_ and `code`');
    expect(spoken).toBe('Heading bold and italic and code');
  });

  it('keeps link text and drops the raw URL', () => {
    expect(cleanForSpeech('See [the docs](https://example.com/x)')).toBe('See the docs');
    expect(cleanForSpeech('Visit https://example.com/x now')).toContain('(link)');
  });

  it('preserves Devanagari text', () => {
    expect(cleanForSpeech('नमस्ते, म NEXUS हुँ।')).toBe('नमस्ते, म NEXUS हुँ।');
  });
});

describe('splitForSpeech', () => {
  it('returns nothing for empty input', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   \n  ')).toEqual([]);
  });

  it('keeps a short answer as a single utterance', () => {
    expect(splitForSpeech('Hello there.')).toEqual(['Hello there.']);
  });

  it('splits a long answer at sentence boundaries', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const chunks = splitForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(MAX_SPEECH_CHUNK));
  });

  it('never truncates: every word survives into some chunk', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`);
    const chunks = splitForSpeech(words.join(' '));
    const rejoined = chunks.join(' ').split(/\s+/);
    expect(rejoined).toEqual(words);
  });

  it('splits a single oversized word rather than discarding it', () => {
    const monster = 'x'.repeat(MAX_SPEECH_CHUNK * 3 + 7);
    const chunks = splitForSpeech(monster, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(monster);
  });

  it('treats the Devanagari danda as a sentence break', () => {
    const chunks = splitForSpeech('पहिलो वाक्य। दोस्रो वाक्य।', 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toContain('पहिलो');
  });

  it('honours a custom chunk size', () => {
    const chunks = splitForSpeech('One two three four five six seven eight.', 12);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(12));
  });
});

const VOICES = [
  { name: 'Microsoft David', lang: 'en-US', default: true },
  { name: 'Samantha', lang: 'en-US' },
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Amelie', lang: 'fr-FR' },
];

describe('selectVoice', () => {
  it('prefers an exact locale match', () => {
    const result = selectVoice(VOICES, 'en-GB');
    expect(result.voice?.name).toBe('Daniel');
    expect(result.exactMatch).toBe(true);
    expect(result.languageAvailable).toBe(true);
  });

  it('prefers a feminine-sounding voice when one exists', () => {
    expect(selectVoice(VOICES, 'en-US').voice?.name).toBe('Samantha');
    expect(selectVoice(VOICES, 'en-US', false).voice?.name).toBe('Microsoft David');
  });

  it('falls back to the same language when the locale is missing', () => {
    const result = selectVoice(VOICES, 'en-AU');
    expect(result.languageAvailable).toBe(true);
    expect(result.exactMatch).toBe(false);
    expect(result.voice?.lang.startsWith('en')).toBe(true);
  });

  it('reports honestly when no voice exists for the language', () => {
    const result = selectVoice(VOICES, 'ne-NP');
    expect(result.voice).toBeNull();
    expect(result.languageAvailable).toBe(false);
  });

  it('handles an empty catalogue without throwing', () => {
    expect(selectVoice([], 'en-US')).toEqual({
      voice: null,
      exactMatch: false,
      languageAvailable: false,
    });
  });
});

describe('hasVoiceForLanguage', () => {
  it('is false for an uninstalled language (Nepali) and true for English', () => {
    expect(hasVoiceForLanguage(VOICES, 'ne-NP')).toBe(false);
    expect(hasVoiceForLanguage(VOICES, 'en-US')).toBe(true);
  });

  it('matches on the primary subtag and tolerates underscores', () => {
    expect(hasVoiceForLanguage([{ name: 'x', lang: 'ne_NP' }], 'ne-NP')).toBe(true);
  });
});

describe('languageLabel', () => {
  it('produces a human label', () => {
    expect(languageLabel('ne-NP').toLowerCase()).toContain('nepali');
    expect(languageLabel('en-US').toLowerCase()).toContain('english');
  });

  it('degrades gracefully for junk input', () => {
    expect(languageLabel('')).toBe('unknown');
  });
});
