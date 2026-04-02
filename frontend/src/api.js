/**
 * API client for the LLM Council backend.
 */

// Dynamically determine API base URL based on current hostname
// This allows the app to work on both localhost and network IPs
const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  const hostname = window.location.hostname;
  return `http://${hostname}:8001`;
};

const API_BASE = getApiBase();

// --- Auth token management ---
let _authToken = null;

/**
 * Set the auth token for all subsequent API calls.
 * Pass null to clear.
 */
export function setAuthToken(token) {
  _authToken = token;
}

/**
 * Get auth headers if a token is set.
 */
function authHeaders() {
  if (!_authToken) return {};
  return { Authorization: `Bearer ${_authToken}` };
}

export const api = {
  // --- Auth endpoints ---

  /**
   * Login with an invite code.
   */
  async login(code) {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new Error('Invalid access code');
    }
    return response.json();
  },

  /**
   * Validate an existing JWT token.
   */
  async validate() {
    const response = await fetch(`${API_BASE}/api/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!response.ok) {
      throw new Error('Token invalid');
    }
    return response.json();
  },

  /**
   * Create a new invite code (admin only).
   */
  async createInvite(label, role = 'user') {
    const response = await fetch(`${API_BASE}/api/admin/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ label, role }),
    });
    if (!response.ok) {
      throw new Error('Failed to create invite');
    }
    return response.json();
  },

  /**
   * Revoke an invite code (admin only).
   */
  async revokeInvite(code) {
    const response = await fetch(`${API_BASE}/api/admin/invite/${encodeURIComponent(code)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to revoke invite');
    }
    return response.json();
  },

  /**
   * List all invite codes with stats (admin only).
   */
  async listInvites() {
    const response = await fetch(`${API_BASE}/api/admin/invites`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to list invites');
    }
    return response.json();
  },
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      { headers: authHeaders() }
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Get council config snapshot for a conversation.
   */
  async getCouncilConfig(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/council-config`,
      { headers: authHeaders() }
    );
    if (!response.ok) {
      throw new Error('Failed to get council config');
    }
    return response.json();
  },

  /**
   * Restore council config from a conversation's snapshot.
   */
  async restoreCouncilConfig(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/restore-config`,
      { method: 'POST', headers: authHeaders() }
    );
    if (!response.ok) {
      throw new Error('Failed to restore council config');
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      { method: 'DELETE', headers: authHeaders() }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Delete all conversations.
   */
  async deleteAllConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to delete all conversations');
    }
    return response.json();
  },

  /**
   * Delete selected conversations by ID.
   */
  async deleteSelectedConversations(conversationIds) {
    const response = await fetch(`${API_BASE}/api/conversations/delete-selected`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ conversation_ids: conversationIds }),
    });
    if (!response.ok) {
      throw new Error('Failed to delete selected conversations');
    }
    return response.json();
  },

  /**
   * Export all conversations as Markdown.
   */
  async exportAllConversations() {
    const response = await fetch(`${API_BASE}/api/conversations/export-all`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to export all conversations');
    }
    return response.blob();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content, webSearch = false) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ content, web_search: webSearch }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Get application settings.
   */
  async getSettings() {
    const response = await fetch(`${API_BASE}/api/settings`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get settings');
    }
    return response.json();
  },

  /**
   * Test Tavily API key.
   */
  async testTavilyKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-tavily`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test OpenRouter API key.
   */
  async testOpenRouterKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-openrouter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test Brave API key.
   */
  async testBraveKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-brave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test Firecrawl API key.
   */
  async testFirecrawlKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-firecrawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    return response.json();
  },

  /**
   * Test a specific provider's API key.
   */
  async testProviderKey(providerId, apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ provider_id: providerId, api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test Ollama connection.
   */
  async testOllamaConnection(baseUrl) {
    const response = await fetch(`${API_BASE}/api/settings/test-ollama`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ base_url: baseUrl }),
    });
    if (!response.ok) {
      throw new Error('Failed to test Ollama connection');
    }
    return response.json();
  },

  /**
   * Test custom OpenAI-compatible endpoint.
   */
  async testCustomEndpoint(name, url, apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-custom-endpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ name, url, api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test custom endpoint');
    }
    return response.json();
  },

  /**
   * Get available models from custom endpoint.
   */
  async getCustomEndpointModels() {
    const response = await fetch(`${API_BASE}/api/custom-endpoint/models`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get custom endpoint models');
    }
    return response.json();
  },

  /**
   * Get available models from OpenRouter.
   */
  async getModels() {
    const response = await fetch(`${API_BASE}/api/models`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get models');
    }
    return response.json();
  },

  /**
   * Get available models from Ollama.
   */
  async getOllamaModels(baseUrl) {
    let url = `${API_BASE}/api/ollama/tags`;
    if (baseUrl) {
      url += `?base_url=${encodeURIComponent(baseUrl)}`;
    }
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get Ollama models');
    }
    return response.json();
  },

  /**
   * Get available models from direct providers.
   */
  async getDirectModels() {
    const response = await fetch(`${API_BASE}/api/models/direct`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get direct models');
    }
    return response.json();
  },

  /**
   * Get default model settings.
   */
  async getDefaultSettings() {
    const response = await fetch(`${API_BASE}/api/settings/defaults`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get default settings');
    }
    return response.json();
  },

  /**
   * Update application settings.
   */
  async updateSettings(settings) {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error('Failed to update settings');
    }
    return response.json();
  },

  /**
   * Reset council configuration to system defaults.
   */
  async resetCouncilConfig() {
    const response = await fetch(`${API_BASE}/api/settings/reset-council`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() }
    });
    if (!response.ok) {
      throw new Error('Failed to reset council config');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {Object} options - Message options
   * @param {string} options.content - The message content
   * @param {boolean} options.webSearch - Whether to use web search
   * @param {string} options.executionMode - Execution mode: 'chat_only', 'chat_ranking', or 'full'
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {AbortSignal} signal - Optional AbortSignal to cancel the request
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, options, onEvent, signal) {
    const { content, webSearch = false, executionMode = 'full', truthCheck = false, debateEnabled = false, roleId = null } = options;
    const bodyPayload = { content, web_search: webSearch, execution_mode: executionMode, truth_check: truthCheck, debate_enabled: debateEnabled };
    if (roleId) bodyPayload.role_id = roleId;
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream?_t=${Date.now()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          ...authHeaders(),
        },
        body: JSON.stringify(bodyPayload),
        signal,
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event = JSON.parse(data);
              onEvent(event.type, event);
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Send a follow-up question to the chairman after a completed deliberation.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The follow-up question
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {AbortSignal} signal - Optional AbortSignal to cancel the request
   * @returns {Promise<void>}
   */
  async sendFollowUpStream(conversationId, content, onEvent, signal) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/follow-up`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          ...authHeaders(),
        },
        body: JSON.stringify({ content }),
        signal,
        cache: 'no-store',
      }
    );

    if (response.status === 429) {
      throw new Error('FOLLOW_UP_LIMIT_REACHED');
    }

    if (!response.ok) {
      throw new Error('Failed to send follow-up');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event = JSON.parse(data);
              onEvent(event.type, event);
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  // --- Rating endpoints ---

  /**
   * Submit a satisfaction rating for an assistant message.
   */
  async submitRating(conversationId, messageIndex, score, comment = null) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/messages/${messageIndex}/rating`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ score, comment }),
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to submit rating' }));
      throw new Error(err.detail || 'Failed to submit rating');
    }
    return response.json();
  },

  /**
   * Get all ratings (admin only).
   */
  async getRatings(filters = {}) {
    const params = new URLSearchParams();
    if (filters.role_id) params.set('role_id', filters.role_id);
    if (filters.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE}/api/admin/ratings${qs ? '?' + qs : ''}`,
      { headers: authHeaders() }
    );
    if (!response.ok) {
      throw new Error('Failed to get ratings');
    }
    return response.json();
  },

  /**
   * Get aggregated rating statistics (admin only).
   */
  async getRatingsSummary() {
    const response = await fetch(`${API_BASE}/api/admin/ratings/summary`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to get ratings summary');
    }
    return response.json();
  },

  /**
   * Get available council roles (locked presets).
   */
  async getRoles() {
    const response = await fetch(`${API_BASE}/api/roles`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to get roles');
    }
    return response.json();
  },

  /**
   * List all presets.
   */
  async listPresets() {
    const response = await fetch(`${API_BASE}/api/presets`, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error('Failed to list presets');
    }
    return response.json();
  },

  /**
   * Create a new preset.
   */
  async createPreset(name, config) {
    const response = await fetch(`${API_BASE}/api/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, config }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error('Preset already exists');
      }
      throw new Error('Failed to create preset');
    }
    return response.json();
  },

  /**
   * Update an existing preset.
   */
  async updatePreset(name, config) {
    const response = await fetch(`${API_BASE}/api/presets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, config }),
    });
    if (!response.ok) {
      throw new Error('Failed to update preset');
    }
    return response.json();
  },

  /**
   * Delete a preset.
   */
  async deletePreset(name) {
    const response = await fetch(`${API_BASE}/api/presets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to delete preset');
    }
    return response.json();
  },

  /**
   * Export multiple presets as a JSON array.
   * @param {string[]|null} presetNames - Names of presets to export, or null for all.
   */
  async exportPresetsBatch(presetNames = null) {
    const response = await fetch(`${API_BASE}/api/presets/batch-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ preset_names: presetNames }),
    });
    if (!response.ok) throw new Error('Failed to export presets');
    return response.json();
  },

  /**
   * Import multiple presets from a JSON array with conflict resolution.
   * @param {Array} presets - Array of {name, config} objects.
   * @param {string} conflictMode - One of 'skip', 'overwrite', 'rename'.
   */
  async importPresetsBatch(presets, conflictMode = 'skip') {
    const response = await fetch(`${API_BASE}/api/presets/batch-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ presets, conflict_mode: conflictMode }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to import presets');
    }
    return response.json();
  },
};

/**
 * Export a conversation to a file format.
 * @param {string} conversationId - The conversation ID
 * @param {string} format - Export format: 'markdown', 'pdf', or 'docx'
 * @returns {Promise<Blob>} - The exported file as a Blob
 */
export async function exportConversation(conversationId, format) {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ format })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Export failed' }));
    throw new Error(error.detail || 'Export failed');
  }

  return response.blob();
}
