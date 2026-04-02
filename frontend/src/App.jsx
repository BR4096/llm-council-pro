import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import Settings from './components/Settings';
import LoginScreen from './components/LoginScreen';
import { api, setAuthToken } from './api';
import './App.css';

function App() {
  const [authToken, setAuthTokenState] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userLabel, setUserLabel] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // On mount, check sessionStorage for existing token
  useEffect(() => {
    const stored = sessionStorage.getItem('council_token');
    if (stored) {
      setAuthToken(stored);
      api.validate()
        .then((data) => {
          setAuthTokenState(stored);
          setUserRole(data.role);
          setUserLabel(data.label);
          setAuthChecked(true);
        })
        .catch(() => {
          sessionStorage.removeItem('council_token');
          setAuthToken(null);
          setAuthChecked(true);
        });
    } else {
      setAuthChecked(true);
    }
  }, []);

  const handleLogin = (token, role, label) => {
    sessionStorage.setItem('council_token', token);
    setAuthToken(token);
    setAuthTokenState(token);
    setUserRole(role);
    setUserLabel(label);
    setNeedsAuth(false);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('council_token');
    setAuthToken(null);
    setAuthTokenState(null);
    setUserRole(null);
    setUserLabel(null);
  };

  // Show login screen if auth is required and no valid token
  // needsAuth: true if the server returned 401 on first API call (auth is enabled)
  const [needsAuth, setNeedsAuth] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState('llm_keys');
  const [ollamaStatus, setOllamaStatus] = useState({
    connected: false,
    lastConnected: null,
    testing: false
  });
  const [councilConfigured, setCouncilConfigured] = useState(true); // Assume configured until checked
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState(null);
  const [searchProvider, setSearchProvider] = useState('duckduckgo');
  const [executionMode, setExecutionMode] = useState('full');
  const [truthCheck, setTruthCheck] = useState(false);
  const [debateEnabled, setDebateEnabled] = useState(false);
  const [debateGatewayActive, setDebateGatewayActive] = useState(false);
  const [debatePending, setDebatePending] = useState(false);
  const [characterNames, setCharacterNames] = useState({});
  const [chairmanCharacterName, setChairmanCharacterName] = useState('');
  const [toastMessage, setToastMessage] = useState(null);
  const [toastType, setToastType] = useState('success');
  const [presets, setPresets] = useState([]);
  const [selectedRole, setSelectedRole] = useState(null);
  const [dictationLanguage, setDictationLanguage] = useState('auto');
  const [settingsKey, setSettingsKey] = useState(0); // Force Settings remount
  const abortControllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const skipNextLoadRef = useRef(false); // Skip loadConversation after lazy creation
  const isInitialMount = useRef(true);
  const isRestoringRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const configVersionRef = useRef(0); // Version counter to prevent stale settings overwrites

  // Build enriched characterNames — only include user-set names, leave unset slots empty
  // so consumers fall through to model name display via their "characterName || shortName" patterns
  const enrichCharacterNames = (rawNames, models) => {
    const names = rawNames || {};
    const enriched = {};
    for (let i = 0; i < (models || []).length; i++) {
      const userSet = names[i] || names[String(i)] || '';
      if (userSet) enriched[i] = userSet;
    }
    return enriched;
  };

  // Check initial configuration on mount and after login
  useEffect(() => {
    checkInitialSetup();
    loadPresets();
  }, [authToken]);

  // Toast helper function
  const showToast = (message, type = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setToastType(type);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      setToastType('success');
    }, 2500);
  };

  const checkInitialSetup = async () => {
    try {
      // 1. Get Settings to check for API keys
      const settings = await api.getSettings();

      // Load execution mode preference
      setExecutionMode(settings.execution_mode || 'full');
      setSearchProvider(settings.search_provider || 'duckduckgo');

      // Load character names from settings
      setCharacterNames(enrichCharacterNames(settings.character_names, settings.council_models));
      setChairmanCharacterName(settings.chairman_character_name || '');

      const hasApiKey = settings.openrouter_api_key_set ||
        settings.groq_api_key_set ||
        settings.openai_api_key_set ||
        settings.anthropic_api_key_set ||
        settings.google_api_key_set ||
        settings.mistral_api_key_set ||
        settings.deepseek_api_key_set;

      // 2. Test Ollama Connection
      // We do this regardless to update the status indicator
      const ollamaUrl = settings.ollama_base_url || 'http://localhost:11434';
      setOllamaStatus(prev => ({ ...prev, testing: true }));

      let isOllamaConnected = false;
      try {
        const result = await api.testOllamaConnection(ollamaUrl);
        isOllamaConnected = result.success;

        if (result.success) {
          setOllamaStatus({
            connected: true,
            lastConnected: new Date().toLocaleString(),
            testing: false
          });
        } else {
          setOllamaStatus({ connected: false, lastConnected: null, testing: false });
        }
      } catch (err) {
        console.error('Ollama initial test failed:', err);
        setOllamaStatus({ connected: false, lastConnected: null, testing: false });
      }

      // 3. Check if council is configured (has models selected)
      const models = settings.council_models || [];
      const chairman = settings.chairman_model || '';

      setCouncilModels(models);
      setChairmanModel(chairman);

      const hasCouncilMembers = models.some(m => m && m.trim() !== '');
      const hasChairman = chairman && chairman.trim() !== '';
      setCouncilConfigured(hasCouncilMembers && hasChairman);

      // 4. If no providers are configured, open settings
      if (!hasApiKey && !isOllamaConnected) {
        setShowSettings(true);
      }

    } catch (error) {
      // If the server returns 401, auth is required
      if (error.message && error.message.includes('Failed to get settings')) {
        // Try a direct fetch to check for 401
        try {
          const resp = await fetch(
            `${import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8001`}/api/settings`
          );
          if (resp.status === 401) {
            setNeedsAuth(true);
            return;
          }
        } catch (_) {
          // Network error, not auth related
        }
      }
      console.error('Failed to check initial setup:', error);
    }
  };

  // Re-check council configuration when settings close
  const handleSettingsClose = async () => {
    setShowSettings(false);
    const thisVersion = ++configVersionRef.current;
    try {
      const settings = await api.getSettings();
      // Abort if a loadConversation started after us
      if (thisVersion !== configVersionRef.current) return;
      const models = settings.council_models || [];
      const chairman = settings.chairman_model || '';

      setCouncilModels(models);
      setChairmanModel(chairman);
      setSearchProvider(settings.search_provider || 'duckduckgo');
      setCharacterNames(enrichCharacterNames(settings.character_names, settings.council_models));
      setChairmanCharacterName(settings.chairman_character_name || '');

      const hasCouncilMembers = models.some(m => m && m.trim() !== '');
      const hasChairman = chairman && chairman.trim() !== '';
      setCouncilConfigured(hasCouncilMembers && hasChairman);
    } catch (error) {
      console.error('Error after closing settings:', error);
    }
  };

  const handleOpenSettings = (section = 'council') => {
    setSettingsInitialSection(section || 'council');
    setShowSettings(true);
  };

  const loadPresets = async () => {
    try {
      const data = await api.listPresets();
      setPresets(data);
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  };

  const handleLoadPreset = async (config, warnings = []) => {
    // Save preset to backend first (this updates all settings)
    try {
      await api.updateSettings({
        council_models: config.council_models,
        chairman_model: config.chairman_model,
        council_temperature: config.council_temperature,
        chairman_temperature: config.chairman_temperature,
        stage2_temperature: config.stage2_temperature,
        character_names: config.character_names || null,
        member_prompts: config.member_prompts || null,
        chairman_character_name: config.chairman_character_name || null,
        chairman_custom_prompt: config.chairman_custom_prompt || null,
        execution_mode: config.execution_mode,
        web_search_enabled: config.web_search_enabled,
        search_provider: config.search_provider,
      });

      // Reload settings to sync local state (only state that exists in App.jsx)
      const settings = await api.getSettings();
      setCouncilModels(settings.council_models || []);
      setChairmanModel(settings.chairman_model || '');
      setCharacterNames(enrichCharacterNames(settings.character_names, settings.council_models));
      setChairmanCharacterName(settings.chairman_character_name || '');
      setExecutionMode(settings.execution_mode || 'full');
      setSearchProvider(settings.search_provider || 'duckduckgo');

      // Show toast with appropriate message
      if (warnings && warnings.length > 0) {
        showToast(`Preset loaded with warnings: ${warnings.join(', ')}`);
      } else {
        showToast('Preset loaded and settings saved');
      }
    } catch (err) {
      console.error('Failed to load preset:', err);
      showToast('Failed to load preset');
    }
  };

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Auto-save execution mode preference when changed
  useEffect(() => {
    // Skip saving on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Skip saving during config restore
    if (isRestoringRef.current) return;

    const saveExecutionMode = async () => {
      try {
        await api.updateSettings({ execution_mode: executionMode });
      } catch (error) {
        console.error('Failed to save execution mode:', error);
      }
    };

    saveExecutionMode();
  }, [executionMode]);

  const testOllamaConnection = async (customUrl = null) => {
    try {
      setOllamaStatus(prev => ({ ...prev, testing: true }));

      // Use custom URL if provided, otherwise get from settings
      let urlToTest = customUrl;
      if (!urlToTest) {
        const settings = await api.getSettings();
        urlToTest = settings.ollama_base_url;
      }

      if (!urlToTest) {
        setOllamaStatus({ connected: false, lastConnected: null, testing: false });
        return;
      }

      const result = await api.testOllamaConnection(urlToTest);

      if (result.success) {
        setOllamaStatus({
          connected: true,
          lastConnected: new Date().toLocaleString(),
          testing: false
        });
      } else {
        setOllamaStatus({ connected: false, lastConnected: null, testing: false });
      }
    } catch (error) {
      console.error('Ollama connection test failed:', error);
      setOllamaStatus({ connected: false, lastConnected: null, testing: false });
    }
  };

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      // Skip loading if we just created the conversation lazily
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false;
        return;
      }
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async (retryCount = 0) => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      // Retry up to 3 times with increasing delays (1s, 2s, 3s)
      if (retryCount < 3) {
        setTimeout(() => loadConversations(retryCount + 1), (retryCount + 1) * 1000);
      }
    }
  };

  const loadConversation = async (id) => {
    const thisVersion = ++configVersionRef.current;
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);

      // Restore council config if conversation has a snapshot and we're not mid-deliberation
      if (!isLoading && conv.council_config) {
        try {
          const result = await api.restoreCouncilConfig(id);
          if (result.restored) {
            // Re-read settings to update local state
            const settings = await api.getSettings();
            // Abort if another loadConversation or handleSettingsClose started after us
            if (thisVersion !== configVersionRef.current) return;
            setCouncilModels(settings.council_models || []);
            setChairmanModel(settings.chairman_model || '');
            setCharacterNames(enrichCharacterNames(settings.character_names, settings.council_models));
            setChairmanCharacterName(settings.chairman_character_name || '');

            // Update councilConfigured state based on restored config
            const hasCouncilMembers = settings.council_models.some(m => m && m.trim() !== '');
            const hasChairman = settings.chairman_model && settings.chairman_model.trim() !== '';
            setCouncilConfigured(hasCouncilMembers && hasChairman);

            // Restore execution mode from snapshot
            isRestoringRef.current = true;
            setExecutionMode(result.council_config.execution_mode || settings.execution_mode || 'full');
            // Reset after a tick
            setTimeout(() => { isRestoringRef.current = false; }, 100);

            showToast('Council config restored');
          }
        } catch (err) {
          console.warn('Failed to restore council config:', err);
          // Non-fatal - conversation still loads fine
        }
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    // Simply clear the current conversation to return to welcome screen
    // Conversation will be created lazily on first message
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setSelectedRole(null);
  };

  const handleClearCouncilConfig = async () => {
    try {
      // Call the reset endpoint (bypasses validation)
      await api.resetCouncilConfig();

      // Update local state to reflect cleared config
      setCouncilModels(["", ""]);
      setChairmanModel("");
      setCharacterNames({});
      setChairmanCharacterName('');
      setCouncilConfigured(false);

      // Force Settings to remount with fresh data
      setSettingsKey(prev => prev + 1);

      return true;
    } catch (error) {
      console.error('Failed to reset council config:', error);
      return false;
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      // Remove from local state
      setConversations(conversations.filter(c => c.id !== id));
      // If we deleted the current conversation, clear it
      if (id === currentConversationId) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      // Don't set to null here - let the request handler clean up
      // This prevents race conditions with rapid clicks
      setIsLoading(false);
    }
  };

  // Derive follow-up mode state from current conversation messages
  const currentMessages = currentConversation?.messages || [];
  const isFollowUpMode = currentMessages.some(
    m => m.role === 'assistant' && m.stage5 != null && !m.type
  );
  const followUpCount = isFollowUpMode
    ? currentMessages.filter(m => m.role === 'user' && m.type === 'follow_up').length
    : 0;
  const MAX_FOLLOW_UPS = 5;

  const handleSendFollowUp = async (content) => {
    if (!currentConversationId || followUpCount >= MAX_FOLLOW_UPS) return;

    abortControllerRef.current = new AbortController();
    setIsLoading(true);

    // Optimistically add user follow-up message
    const userMsg = { role: 'user', content, type: 'follow_up' };
    const loadingMsg = { role: 'assistant', type: 'follow_up', stage5: null, loading: { stage5: true } };

    setCurrentConversation((prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg, loadingMsg],
    }));

    try {
      await api.sendFollowUpStream(
        currentConversationId,
        content,
        (eventType, event) => {
          switch (eventType) {
            case 'follow_up_chunk':
              setCurrentConversation((prev) => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                const currentText = (last.stage5?.response || '') + event.data.text;
                msgs[msgs.length - 1] = {
                  ...last,
                  stage5: { ...(last.stage5 || {}), response: currentText },
                };
                return { ...prev, messages: msgs };
              });
              break;

            case 'follow_up_complete':
              setCurrentConversation((prev) => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                msgs[msgs.length - 1] = {
                  ...last,
                  stage5: { model: event.data.model, response: event.data.response },
                  loading: { ...last.loading, stage5: false },
                };
                return { ...prev, messages: msgs };
              });
              break;

            case 'complete':
              setIsLoading(false);
              break;

            case 'error':
              console.error('[FollowUp] Error:', event.message);
              setCurrentConversation((prev) => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                msgs[msgs.length - 1] = { ...last, loading: { ...last.loading, stage5: false } };
                return { ...prev, messages: msgs };
              });
              setIsLoading(false);
              break;
          }
        },
        abortControllerRef.current.signal
      );
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[FollowUp] Stream error:', error);
      }
      setCurrentConversation((prev) => {
        if (!prev || prev.messages.length === 0) return prev;
        const msgs = [...prev.messages];
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = { ...last, loading: { ...last.loading, stage5: false } };
        return { ...prev, messages: msgs };
      });
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (content, webSearch, truthCheckEnabled = false, debateEnabled_arg = false) => {
    // Branch to follow-up handler when a completed deliberation exists
    if (isFollowUpMode) {
      handleSendFollowUp(content);
      return;
    }

    // LAZY INITIALIZATION: Create conversation if none exists
    let conversationId = currentConversationId;

    if (!conversationId) {
      try {
        const newConv = await api.createConversation();
        conversationId = newConv.id;
        // Skip the loadConversation call triggered by setCurrentConversationId
        // because we're about to initialize the state ourselves
        skipNextLoadRef.current = true;
        setCurrentConversationId(conversationId);
        setConversations([
          { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
          ...conversations,
        ]);
        // Initialize currentConversation with the new conversation
        setCurrentConversation({
          id: newConv.id,
          created_at: newConv.created_at,
          messages: [],
          title: null,
        });
      } catch (error) {
        console.error('Failed to create conversation:', error);
        return;  // Early return on failure - don't proceed with message
      }
    }

    // Reset debate gateway state for new conversation
    setDebateGatewayActive(false);
    setDebatePending(debateEnabled);

    // Assign unique ID to this request to prevent race conditions
    const currentRequestId = ++requestIdRef.current;

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        stage4: null,
        stage5: null,
        metadata: null,
        loading: {
          search: false,
          stage1: false,
          stage2: false,
          stage3: false,
          stage4: false,
          stage5: false,
        },
        timers: {
          stage1Start: null,
          stage1End: null,
          stage2Start: null,
          stage2End: null,
          stage3Start: null,
          stage3End: null,
          stage4Start: null,
          stage4End: null,
          stage5Start: null,
          stage5End: null,
        },
        progress: {
          stage1: { count: 0, total: 0, currentModel: null },
          stage2: { count: 0, total: 0, currentModel: null },
          stage3: { count: 0, total: 0, currentModel: null }
        }
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(
        conversationId,
        { content, webSearch, executionMode, truthCheck: truthCheckEnabled, debateEnabled: debateEnabled_arg, roleId: selectedRole },
        (eventType, event) => {
          switch (eventType) {
            case 'search_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  loading: {
                    ...lastMsg.loading,
                    search: true
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'search_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  loading: {
                    ...lastMsg.loading,
                    search: false
                  },
                  metadata: {
                    ...lastMsg.metadata,
                    search_query: event.data.search_query,
                    extracted_query: event.data.extracted_query,
                    search_context: event.data.search_context,
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage1_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  loading: {
                    ...lastMsg.loading,
                    stage1: true
                  },
                  timers: {
                    ...lastMsg.timers,
                    stage1Start: Date.now()
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage1_init':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  progress: {
                    ...lastMsg.progress,
                    stage1: {
                      count: 0,
                      total: event.total,
                      currentModel: null
                    }
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage1_progress':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                // Immutable update for stage1
                const updatedStage1 = lastMsg.stage1 ? [...lastMsg.stage1, event.data] : [event.data];
                const updatedLastMsg = {
                  ...lastMsg,
                  progress: {
                    ...lastMsg.progress,
                    stage1: {
                      count: event.count,
                      total: event.total,
                      currentModel: event.data.model
                    }
                  },
                  stage1: updatedStage1
                };

                messages[messages.length - 1] = updatedLastMsg;

                return { ...prev, messages };
              });
              break;

            case 'stage1_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                // Immutable update to prevent React rendering issues
                const updatedLastMsg = {
                  ...lastMsg,
                  stage1: event.data,
                  loading: {
                    ...lastMsg.loading,
                    stage1: false
                  },
                  timers: {
                    ...lastMsg.timers,
                    stage1End: Date.now()
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage2_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  loading: {
                    ...lastMsg.loading,
                    stage2: true
                  },
                  timers: {
                    ...lastMsg.timers,
                    stage2Start: Date.now()
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage2_init':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  progress: {
                    ...lastMsg.progress,
                    stage2: {
                      count: 0,
                      total: event.total,
                      currentModel: null
                    }
                  },
                  metadata: {
                    ...lastMsg.metadata,
                    label_to_model: event.label_to_model,
                    label_to_instance_key: event.label_to_instance_key
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage2_progress':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                // Immutable update for stage2
                const updatedStage2 = lastMsg.stage2 ? [...lastMsg.stage2, event.data] : [event.data];
                const updatedLastMsg = {
                  ...lastMsg,
                  progress: {
                    ...lastMsg.progress,
                    stage2: {
                      count: event.count,
                      total: event.total,
                      currentModel: event.data.model
                    }
                  },
                  stage2: updatedStage2
                };

                messages[messages.length - 1] = updatedLastMsg;

                return { ...prev, messages };
              });
              break;

            case 'stage2_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                // Immutable update to prevent React rendering issues
                const updatedLastMsg = {
                  ...lastMsg,
                  stage2: event.data,
                  loading: {
                    ...lastMsg.loading,
                    stage2: false
                  },
                  timers: {
                    ...lastMsg.timers,
                    stage2End: Date.now()
                  },
                  metadata: {
                    ...lastMsg.metadata,
                    ...event.metadata
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage3_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                const updatedLastMsg = {
                  ...lastMsg,
                  loading: { ...lastMsg.loading, stage3: true },
                  timers: { ...lastMsg.timers, stage3Start: Date.now() }
                };
                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage3_init':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                const updatedLastMsg = {
                  ...lastMsg,
                  progress: {
                    ...lastMsg.progress,
                    stage3: { count: 0, total: event.total, currentModel: null }
                  }
                };
                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage3_progress':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                const updatedStage3 = lastMsg.stage3 ? [...lastMsg.stage3, event.data] : [event.data];
                const updatedLastMsg = {
                  ...lastMsg,
                  progress: {
                    ...lastMsg.progress,
                    stage3: {
                      count: event.count,
                      total: event.total,
                      currentModel: event.data.model
                    }
                  },
                  stage3: updatedStage3
                };
                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage3_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                const updatedLastMsg = {
                  ...lastMsg,
                  stage3: event.data,
                  loading: { ...lastMsg.loading, stage3: false },
                  timers: { ...lastMsg.timers, stage3End: Date.now() }
                };
                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage4_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  loading: { ...lastMsg.loading, stage4: true },
                  timers: { ...lastMsg.timers, stage4Start: Date.now() }
                };
                return { ...prev, messages };
              });
              break;

            case 'stage4_highlights_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                // Only set if not already set (stage4_start may have already triggered this)
                if (lastMsg.loading?.stage4) return prev;
                messages[messages.length - 1] = {
                  ...lastMsg,
                  loading: { ...lastMsg.loading, stage4: true },
                  timers: { ...lastMsg.timers, stage4Start: Date.now() }
                };
                return { ...prev, messages };
              });
              break;

            case 'stage4_rankings_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                // Only set loading.stage4 if not already set (stage4_start or stage4_highlights_start already set it)
                if (lastMsg.loading?.stage4) return prev;
                messages[messages.length - 1] = {
                  ...lastMsg,
                  loading: { ...lastMsg.loading, stage4: true },
                  timers: { ...lastMsg.timers, stage4Start: Date.now() }
                };
                return { ...prev, messages };
              });
              break;

            case 'stage4_truthcheck_complete':
              console.log('[DEBUG] stage4_truthcheck_complete event received:', {
                hasData: !!event.data,
                claimsCount: event.data?.claims?.length || 0,
                checked: event.data?.checked,
                error: event.data?.error
              });
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  stage4: {
                    ...(lastMsg.stage4 || {}),
                    truth_check: event.data
                  }
                };
                return { ...prev, messages };
              });
              break;

            case 'stage4_highlights_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  stage4: {
                    ...(lastMsg.stage4 || {}),
                    highlights: event.data
                  }
                };
                return { ...prev, messages };
              });
              break;

            case 'stage4_rankings_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  stage4: {
                    ...(lastMsg.stage4 || {}),
                    rankings: event.data
                  },
                  loading: { ...lastMsg.loading, stage4: false },
                  timers: { ...lastMsg.timers, stage4End: Date.now() }
                };
                return { ...prev, messages };
              });
              break;

            case 'gateway_ready':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  stage4: {
                    ...(lastMsg.stage4 || {}),
                    gateway_issues: event.data?.issues || []
                  },
                  loading: { ...lastMsg.loading, stage4: false },
                  timers: { ...lastMsg.timers, stage4End: Date.now() }
                };
                return { ...prev, messages };
              });
              setDebateGatewayActive(true);
              setDebatePending(false);
              break;

            case 'stage5_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                const updatedLastMsg = {
                  ...lastMsg,
                  loading: {
                    ...lastMsg.loading,
                    stage5: true
                  },
                  timers: {
                    ...lastMsg.timers,
                    stage5Start: Date.now()
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              break;

            case 'stage5_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];

                // Immutable update to prevent React rendering issues
                const updatedLastMsg = {
                  ...lastMsg,
                  stage5: event.data,
                  loading: {
                    ...lastMsg.loading,
                    stage5: false
                  },
                  timers: {
                    ...lastMsg.timers,
                    stage5End: Date.now()
                  }
                };

                messages[messages.length - 1] = updatedLastMsg;
                return { ...prev, messages };
              });
              // Hide loading indicator once final answer is shown
              setIsLoading(false);
              break;

            case 'title_complete':
              // Reload conversations to get updated title
              loadConversations();
              break;

            case 'complete':
              // Stream complete, reload conversations list
              loadConversations();
              setIsLoading(false);
              break;

            case 'error':
              console.error('Stream error:', event.message);
              setIsLoading(false);
              // Clear all loading spinners in the message state so nothing hangs
              setCurrentConversation((prev) => {
                if (!prev || prev.messages.length === 0) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role !== 'assistant') return prev;
                messages[messages.length - 1] = {
                  ...lastMsg,
                  loading: {
                    search: false,
                    stage1: false,
                    stage2: false,
                    stage3: false,
                    stage4: false,
                    stage5: false,
                  },
                };
                return { ...prev, messages };
              });
              break;

            default:
              console.log('Unknown event type:', eventType);
          }
        }, abortControllerRef.current?.signal);
    } catch (error) {
      // Handle aborted requests - mark message as aborted
      if (error.name === 'AbortError') {
        console.log('Request aborted');
        // Mark the assistant message as aborted and stop timers
        setCurrentConversation((prev) => {
          if (!prev || prev.messages.length < 2) return prev;
          const messages = [...prev.messages];
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.role === 'assistant') {
            const now = Date.now();
            messages[messages.length - 1] = {
              ...lastMsg,
              aborted: true,
              loading: {
                search: false,
                stage1: false,
                stage2: false,
                stage3: false,
                stage4: false,
                stage5: false,
              },
              timers: {
                ...lastMsg.timers,
                // Stop any running timers
                stage1End: lastMsg.timers?.stage1Start && !lastMsg.timers?.stage1End ? now : lastMsg.timers?.stage1End,
                stage2End: lastMsg.timers?.stage2Start && !lastMsg.timers?.stage2End ? now : lastMsg.timers?.stage2End,
                stage3End: lastMsg.timers?.stage3Start && !lastMsg.timers?.stage3End ? now : lastMsg.timers?.stage3End,
                stage4End: lastMsg.timers?.stage4Start && !lastMsg.timers?.stage4End ? now : lastMsg.timers?.stage4End,
                stage5End: lastMsg.timers?.stage5Start && !lastMsg.timers?.stage5End ? now : lastMsg.timers?.stage5End,
              }
            };
          }
          return { ...prev, messages };
        });
        return;
      }
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    } finally {
      // Only clear the controller if this is still the current request
      // This prevents race conditions if user rapidly sends multiple messages
      if (requestIdRef.current === currentRequestId) {
        abortControllerRef.current = null;
      }
      // Reload conversations to ensure title/messages are synced, even if aborted
      loadConversations();
    }
  };

  const handleRunDebate = async (issueIdx) => {
    if (!currentConversationId) return;

    // Capture turn metadata per turn (turn_start sets, debate_token uses)
    const currentTurnMeta = { name: '', role: '', model_id: '' };

    // Mark this debate as running in state
    setCurrentConversation((prev) => {
      const messages = [...prev.messages];
      const lastMsg = messages[messages.length - 1];
      const debates = [...(lastMsg.stage4?.debates || [])];
      const filtered = debates.filter(d => d.idx !== issueIdx);
      filtered.push({
        idx: issueIdx,
        status: 'running',
        transcript: [],
        participants: lastMsg.stage4?.gateway_issues?.[issueIdx]?.participants || []
      });
      messages[messages.length - 1] = {
        ...lastMsg,
        stage4: { ...(lastMsg.stage4 || {}), debates: filtered }
      };
      return { ...prev, messages };
    });

    try {
      const apiBase = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8001`;
      const response = await fetch(
        `${apiBase}/debate/${currentConversationId}/${issueIdx}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );

      if (!response.ok) {
        throw new Error(`Debate request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'turn_start':
                currentTurnMeta.name = event.data?.name || '';
                currentTurnMeta.role = event.data?.role || '';
                currentTurnMeta.model_id = event.data?.model_id || '';
                if (event.data?.total_turns) {
                  setCurrentConversation((prev) => {
                    const messages = [...prev.messages];
                    const lastMsg = messages[messages.length - 1];
                    const debates = [...(lastMsg.stage4?.debates || [])];
                    const idx = debates.findIndex(d => d.idx === issueIdx);
                    if (idx >= 0) {
                      debates[idx] = { ...debates[idx], meta: { ...(debates[idx]?.meta || {}), total_turns: event.data.total_turns } };
                    }
                    messages[messages.length - 1] = { ...lastMsg, stage4: { ...(lastMsg.stage4 || {}), debates } };
                    return { ...prev, messages };
                  });
                }
                break;

              case 'debate_token': {
                const capturedName = currentTurnMeta.name;
                const capturedRole = currentTurnMeta.role;
                const capturedModelId = currentTurnMeta.model_id;
                setCurrentConversation((prev) => {
                  const messages = [...prev.messages];
                  const lastMsg = messages[messages.length - 1];
                  const debates = [...(lastMsg.stage4?.debates || [])];
                  const idx = debates.findIndex(d => d.idx === issueIdx);
                  if (idx >= 0) {
                    const debate = { ...debates[idx] };
                    debate.transcript = [
                      ...(debate.transcript || []),
                      {
                        role: capturedRole,
                        name: capturedName,
                        model_id: capturedModelId,
                        text: event.data?.text || ''
                      }
                    ];
                    debates[idx] = debate;
                  }
                  messages[messages.length - 1] = { ...lastMsg, stage4: { ...(lastMsg.stage4 || {}), debates } };
                  return { ...prev, messages };
                });
                break;
              }

              case 'verdict':
                setCurrentConversation((prev) => {
                  const messages = [...prev.messages];
                  const lastMsg = messages[messages.length - 1];
                  const debates = [...(lastMsg.stage4?.debates || [])];
                  const idx = debates.findIndex(d => d.idx === issueIdx);
                  if (idx >= 0) {
                    debates[idx] = { ...debates[idx], verdict: event.data };
                  }
                  messages[messages.length - 1] = { ...lastMsg, stage4: { ...(lastMsg.stage4 || {}), debates } };
                  return { ...prev, messages };
                });
                break;

              case 'debate_done':
                setCurrentConversation((prev) => {
                  const messages = [...prev.messages];
                  const lastMsg = messages[messages.length - 1];
                  const debates = [...(lastMsg.stage4?.debates || [])];
                  const idx = debates.findIndex(d => d.idx === issueIdx);
                  if (idx >= 0) {
                    debates[idx] = event.data;
                  } else {
                    debates.push(event.data);
                  }
                  messages[messages.length - 1] = { ...lastMsg, stage4: { ...(lastMsg.stage4 || {}), debates } };
                  return { ...prev, messages };
                });
                break;
            }
          } catch (e) {
            // Skip unparseable SSE lines
          }
        }
      }
    } catch (error) {
      console.error('Debate execution error:', error);
      setCurrentConversation((prev) => {
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        const debates = [...(lastMsg.stage4?.debates || [])];
        const idx = debates.findIndex(d => d.idx === issueIdx);
        if (idx >= 0) {
          debates[idx] = {
            ...debates[idx],
            status: 'failed',
            meta: { ...(debates[idx]?.meta || {}), error: error.message }
          };
        }
        messages[messages.length - 1] = { ...lastMsg, stage4: { ...(lastMsg.stage4 || {}), debates } };
        return { ...prev, messages };
      });
    }
  };

  const handleProceedToSynthesis = async () => {
    if (!currentConversationId) return;

    // Immediately hide the debate gateway and show stage5 loading area.
    // setDebateGatewayActive(false) is synchronous — hides "Proceed" button before async work,
    // preventing double-clicks.
    setDebateGatewayActive(false);
    setIsLoading(true);

    // Set stage5 loading state in the message
    setCurrentConversation((prev) => {
      if (!prev || prev.messages.length === 0) return prev;
      const messages = [...prev.messages];
      const lastMsg = messages[messages.length - 1];
      messages[messages.length - 1] = {
        ...lastMsg,
        loading: { ...lastMsg.loading, stage5: true },
        timers: { ...lastMsg.timers, stage5Start: Date.now() },
      };
      return { ...prev, messages };
    });

    try {
      const apiBase = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8001`;
      const response = await fetch(
        `${apiBase}/api/conversations/${currentConversationId}/stage5`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );

      if (!response.ok) {
        throw new Error(`Stage 5 request failed: ${response.status}`);
      }

      // Stream SSE events — same pattern as handleRunDebate
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'stage5_start':
                // loading.stage5 already set above — no additional state change needed
                break;

              case 'stage5_complete':
                setCurrentConversation((prev) => {
                  if (!prev || prev.messages.length === 0) return prev;
                  const messages = [...prev.messages];
                  const lastMsg = messages[messages.length - 1];
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    stage5: event.data,
                    loading: { ...lastMsg.loading, stage5: false },
                    timers: { ...lastMsg.timers, stage5End: Date.now() },
                  };
                  return { ...prev, messages };
                });
                setIsLoading(false);
                break;

              case 'title_complete':
                loadConversations();
                break;

              case 'complete':
                loadConversations();
                setIsLoading(false);
                break;

              case 'error':
                console.error('[Stage5 Endpoint] Error:', event.message);
                setCurrentConversation((prev) => {
                  if (!prev || prev.messages.length === 0) return prev;
                  const messages = [...prev.messages];
                  const lastMsg = messages[messages.length - 1];
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    loading: { ...lastMsg.loading, stage5: false },
                  };
                  return { ...prev, messages };
                });
                setIsLoading(false);
                break;
            }
          } catch (e) {
            // Skip unparseable SSE lines
          }
        }
      }
    } catch (error) {
      console.error('Stage 5 synthesis error:', error);
      // Clear loading state on failure
      setCurrentConversation((prev) => {
        if (!prev || prev.messages.length === 0) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        messages[messages.length - 1] = {
          ...lastMsg,
          loading: { ...lastMsg.loading, stage5: false },
        };
        return { ...prev, messages };
      });
      setIsLoading(false);
    }
  };

  // If auth check hasn't completed, show nothing (avoids flash)
  if (!authChecked) {
    return null;
  }

  // If we have no token and the server requires auth, show login.
  // We detect this by checking if authToken is null AND we got a 401 on checkInitialSetup.
  // For simplicity: if no token is stored, try rendering the app normally.
  // The checkInitialSetup will fail with 401 if auth is required, triggering login.
  if (!authToken && authChecked && needsAuth) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => setShowSettings(true)}
        isLoading={isLoading}
        onAbort={handleAbort}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onAbort={handleAbort}
        isLoading={isLoading}
        councilConfigured={councilConfigured}
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        searchProvider={searchProvider}
        onOpenSettings={handleOpenSettings}
        executionMode={executionMode}
        onExecutionModeChange={setExecutionMode}
        characterNames={characterNames}
        chairmanCharacterName={chairmanCharacterName}
        presets={presets}
        onLoadPreset={handleLoadPreset}
        onNewDiscussion={handleNewConversation}
        onClearCouncilConfig={handleClearCouncilConfig}
        showToast={showToast}
        dictationLanguage={dictationLanguage === 'auto' ? null : dictationLanguage}
        truthCheck={truthCheck}
        onTruthCheckChange={setTruthCheck}
        debate={debateEnabled}
        onDebateChange={setDebateEnabled}
        onRunDebate={handleRunDebate}
        debateGatewayActive={debateGatewayActive}
        debatePending={debatePending}
        onProceedToSynthesis={handleProceedToSynthesis}
        isFollowUpMode={isFollowUpMode}
        followUpCount={followUpCount}
        maxFollowUps={MAX_FOLLOW_UPS}
        selectedRole={selectedRole}
        onSelectRole={setSelectedRole}
      />
      {showSettings && (
        <Settings
          key={settingsKey}
          onClose={handleSettingsClose}
          ollamaStatus={ollamaStatus}
          onRefreshOllama={testOllamaConnection}
          initialSection={settingsInitialSection}
          onPresetsChange={loadPresets}
          isFrozen={currentConversation?.messages?.length > 0}
          dictationLanguage={dictationLanguage}
          setDictationLanguage={setDictationLanguage}
          onNewDiscussion={handleNewConversation}
          onClearCouncilConfig={handleClearCouncilConfig}
          onConversationsChange={loadConversations}
        />
      )}
      {toastMessage && (
        <div className={`toast-notification toast-${toastType}`}>
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default App;
