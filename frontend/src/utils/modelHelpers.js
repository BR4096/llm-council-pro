// Helper to get visual properties for models

export const getModelVisuals = (modelId) => {
  if (!modelId) return { name: 'Unknown', color: '#94a3b8', short: '?' };

  const id = modelId.toLowerCase();

  // Ollama - CHECK FIRST because "ollama" contains "llama" substring
  if (id.startsWith('ollama:')) {
    return { name: 'Ollama', color: '#f1f5f9', short: 'Local', icon: '🦙' };
  }

  // OpenAI
  if (id.includes('openai') || id.includes('gpt')) {
    return { name: 'OpenAI', color: '#10a37f', short: 'GPT', icon: '🤖' };
  }

  // Anthropic
  if (id.includes('anthropic') || id.includes('claude')) {
    return { name: 'Anthropic', color: '#d97757', short: 'Claude', icon: '🧠' };
  }

  // Google
  if (id.includes('google') || id.includes('gemini')) {
    return { name: 'Google', color: '#4285f4', short: 'Gemini', icon: '✨' };
  }

  // Mistral
  if (id.includes('mistral')) {
    return { name: 'Mistral', color: '#5a4bda', short: 'Mistral', icon: '🌪️' };
  }

  // Groq (Provider, often Llama or Mixtral)
  // Check this BEFORE Meta/Mistral because Groq hosts those models
  if (id.includes('groq') || id.includes('versatile') || id.includes('instant')) {
    return { name: 'Groq', color: '#f97316', short: 'Groq', icon: '⚡' };
  }

  // Meta / Llama
  if (id.includes('meta') || id.includes('llama')) {
    return { name: 'Meta', color: '#0668e1', short: 'Llama', icon: '🦙' };
  }

  // DeepSeek
  if (id.includes('deepseek')) {
    return { name: 'DeepSeek', color: '#4e80ee', short: 'DeepSeek', icon: '🐋' };
  }

  // Perplexity
  if (id.startsWith('perplexity:') || id.includes('sonar')) {
    return { name: 'Perplexity', color: '#20b8cd', short: 'Perplexity', icon: '🔍' };
  }

  // Local (fallback for models without provider prefix or slash)
  if (!id.includes('/') && !id.includes(':')) {
    return { name: 'Local', color: '#f1f5f9', short: 'Local', icon: '💻' };
  }

  // Default
  return { name: 'Model', color: '#94a3b8', short: 'AI', icon: '🤖' };
};

export const getShortModelName = (modelId) => {
  if (!modelId) return 'Unknown';
  // Handle "provider/model-name" format
  const parts = modelId.split('/');
  if (parts.length > 1) return parts[1];
  // Handle "provider:model-name" format
  const colParts = modelId.split(':');
  if (colParts.length > 1) return colParts[1];
  return modelId;
};

/**
 * Strip inline footnote markers from Perplexity responses.
 * Perplexity returns markdown with [1], [2], [1][2] etc. markers
 * that reference the separate citations array.
 * @param {string} content - Response text that may contain footnotes
 * @param {string} modelId - Model ID to check if it's a Perplexity model
 * @returns {string} Content with footnote markers removed (if Perplexity)
 */
export const stripFootnoteMarkers = (content, modelId) => {
  if (!content || typeof content !== 'string') return content || '';
  if (!modelId) return content;

  const id = modelId.toLowerCase();
  const isPerplexity = id.startsWith('perplexity:') || id.includes('sonar');

  if (!isPerplexity) return content;

  // Remove footnote markers like [1], [2], [1][2], [3][4][5], etc.
  // This regex matches one or more consecutive [number] patterns
  return content.replace(/(\[\d+\])+/g, '');
};

/**
 * Build display names for all council slots with duplicate disambiguation.
 * Mirrors backend build_display_names() in council.py.
 * Uses character names when set, falls back to short model names.
 * When multiple slots share the same short name (duplicate models),
 * uses "Member N" (1-indexed by slot position).
 *
 * @param {string[]} councilModels - Ordered list of model IDs
 * @param {Object} characterNames - Dict mapping index (string or number) to character name
 * @returns {Object} Map of slot index (number) to display name string
 */
export const buildDisplayNames = (councilModels, characterNames = {}) => {
  const slotNames = {};
  const shortNameSlots = {}; // shortName -> [indices that need this name]

  (councilModels || []).forEach((modelId, i) => {
    const charName = characterNames?.[i] || characterNames?.[String(i)];
    if (charName) {
      slotNames[i] = charName;
    } else {
      const short = getShortModelName(modelId);
      slotNames[i] = short;
      if (!shortNameSlots[short]) shortNameSlots[short] = [];
      shortNameSlots[short].push(i);
    }
  });

  // Disambiguate duplicate short names — use "Member N" (1-indexed slot)
  Object.entries(shortNameSlots).forEach(([short, indices]) => {
    if (indices.length > 1) {
      indices.forEach((idx) => {
        slotNames[idx] = `Member ${idx + 1}`;
      });
    }
  });

  return slotNames;
};

// --- Shared name-highlighting utilities ---

const NAME_STOPWORDS = new Set([
  'the', 'and', 'for', 'not', 'but', 'yet', 'nor',
  'von', 'van', 'del', 'der', 'das', 'die', 'les',
  'member'
]);

const MIN_NAME_PART_LENGTH = 3;

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeDashes(text) {
  return text.replace(/[\u2010-\u2015\u00AD]/g, '-');
}

/**
 * Given an array of display names, return a deduplicated longest-first array
 * containing the original names plus individual parts of multi-word names
 * (filtered by minimum length and stopwords).
 */
export function getNameVariants(names) {
  const variants = new Set();
  for (const name of names) {
    if (!name) continue;
    variants.add(name);
    const parts = name.split(/\s+/);
    if (parts.length > 1) {
      for (const part of parts) {
        if (part.length >= MIN_NAME_PART_LENGTH && !NAME_STOPWORDS.has(part.toLowerCase())) {
          variants.add(part);
        }
      }
    }
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

export { NAME_STOPWORDS };
