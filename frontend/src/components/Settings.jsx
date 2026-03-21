import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import SearchableModelSelect from './SearchableModelSelect';
import ProviderSettings from './settings/ProviderSettings';
import CouncilConfig from './settings/CouncilConfig';
import SearchSettings from './settings/SearchSettings';
import TruthCheckSettings from './settings/TruthCheckSettings';
import PromptSettings from './settings/PromptSettings';
import PresetSettings from './settings/PresetSettings';
import DictationSettings from './settings/DictationSettings';
import './Settings.css';





export default function Settings({
  onClose,
  ollamaStatus,
  onRefreshOllama,
  initialSection = 'llm_keys',
  onPresetsChange,
  isFrozen,
  onNewDiscussion,
  onClearCouncilConfig,
  dictationLanguage: parentDictationLanguage,
  setDictationLanguage: setParentDictationLanguage,
  onConversationsChange
}) {
  const [activeSection, setActiveSection] = useState(initialSection); // 'llm_keys', 'council', 'prompts', 'search', 'import_export'

  const [settings, setSettings] = useState(null);
  const [selectedSearchProvider, setSelectedSearchProvider] = useState('duckduckgo');
  const [selectedTruthCheckProvider, setSelectedTruthCheckProvider] = useState('duckduckgo');
  const [searchKeywordExtraction, setSearchKeywordExtraction] = useState('direct');

  const handleTruthCheckProviderChange = async (provider) => {
    setSelectedTruthCheckProvider(provider);
    try {
      await api.updateSettings({ truth_check_provider: provider });
    } catch (err) {
      console.error('Failed to save truth_check_provider', err);
    }
  };
  const [fullContentResults, setFullContentResults] = useState(3);
  const [searchResultsCount, setSearchResultsCount] = useState(6);
  const [dictationLanguage, setDictationLanguage] = useState('auto');

  // OpenRouter State
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [isTestingOpenRouter, setIsTestingOpenRouter] = useState(false);
  const [openrouterTestResult, setOpenrouterTestResult] = useState(null);

  // Groq State
  const [groqApiKey, setGroqApiKey] = useState('');
  const [isTestingGroq, setIsTestingGroq] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState(null);

  // Ollama State
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434');
  const [ollamaAvailableModels, setOllamaAvailableModels] = useState([]);
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState(null);

  // Custom OpenAI-compatible Endpoint State
  const [customEndpointName, setCustomEndpointName] = useState('');
  const [customEndpointUrl, setCustomEndpointUrl] = useState('');
  const [customEndpointApiKey, setCustomEndpointApiKey] = useState('');
  const [customEndpointModels, setCustomEndpointModels] = useState([]);
  const [isTestingCustomEndpoint, setIsTestingCustomEndpoint] = useState(false);
  const [customEndpointTestResult, setCustomEndpointTestResult] = useState(null);

  // Direct Provider State
  const [directKeys, setDirectKeys] = useState({
    openai_api_key: '',
    anthropic_api_key: '',
    google_api_key: '',
    perplexity_api_key: '',
    mistral_api_key: '',
    deepseek_api_key: '',
    glm_api_key: '',
    kimi_api_key: ''
  });
  const [directAvailableModels, setDirectAvailableModels] = useState([]);

  // Validation State
  const [validatingKeys, setValidatingKeys] = useState({});
  const [keyValidationStatus, setKeyValidationStatus] = useState({});

  // Search API Keys
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [braveApiKey, setBraveApiKey] = useState('');
  const [isTestingTavily, setIsTestingTavily] = useState(false);
  const [isTestingBrave, setIsTestingBrave] = useState(false);
  const [tavilyTestResult, setTavilyTestResult] = useState(null);
  const [braveTestResult, setBraveTestResult] = useState(null);
  const [firecrawlApiKey, setFirecrawlApiKey] = useState('');
  const [isTestingFirecrawl, setIsTestingFirecrawl] = useState(false);
  const [firecrawlTestResult, setFirecrawlTestResult] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Enabled Providers (which sources are available)
  const [enabledProviders, setEnabledProviders] = useState({
    openrouter: true,
    ollama: false,
    groq: false,
    direct: false,  // Master toggle for all direct connections
    custom: false   // Custom OpenAI-compatible endpoint
  });

  // Individual direct provider toggles
  const [directProviderToggles, setDirectProviderToggles] = useState({
    openai: false,
    anthropic: false,
    google: false,
    perplexity: false,
    mistral: false,
    deepseek: false,
    glm: false,
    kimi: false
  });

  // Council Configuration (unified across all providers)
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [councilTemperature, setCouncilTemperature] = useState(0.5);
  const [chairmanTemperature, setChairmanTemperature] = useState(0.4);
  const [stage2Temperature, setStage2Temperature] = useState(0.3);
  const [stage3Temperature, setStage3Temperature] = useState(0.5);
  const [stage5Temperature, setStage5Temperature] = useState(0.4);

  // System Prompts State
  const [prompts, setPrompts] = useState({
    stage1_prompt: '',
    stage2_prompt: '',
    revision_prompt: '',
    stage3_prompt: '',
    stage5_prompt: '',
    title_prompt: '',
    debate_turn_primary_a_prompt: '',
    debate_turn_rebuttal_prompt: '',
    debate_verdict_prompt: '',
  });
  const [activePromptTab, setActivePromptTab] = useState('stage1');

  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Remote/Local filter toggles per model type
  const [councilMemberFilters, setCouncilMemberFilters] = useState({});  // Per-member filters (indexed by member index)
  const [chairmanFilter, setChairmanFilter] = useState('remote');

  // Character Names and Member Prompts
  const [characterNames, setCharacterNames] = useState({});
  const [memberPrompts, setMemberPrompts] = useState({});

  // Chairman Character Name and Custom Prompt
  const [chairmanCharacterName, setChairmanCharacterName] = useState('');
  const [chairmanCustomPrompt, setChairmanCustomPrompt] = useState('');

  // Default Member Role (fallback for members without custom prompts)
  const [defaultMemberRole, setDefaultMemberRole] = useState('');

  // Chat Management State
  const [chatList, setChatList] = useState([]);
  const [selectedChats, setSelectedChats] = useState(new Set());
  const [isLoadingChatList, setIsLoadingChatList] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [chatManagementError, setChatManagementError] = useState(null);
  const [chatManagementSuccess, setChatManagementSuccess] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  // Update activeSection when initialSection prop changes
  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  // Check for changes
  useEffect(() => {
    if (!settings) return;

    const checkChanges = () => {
      if (selectedSearchProvider !== settings.search_provider) return true;
      if (searchKeywordExtraction !== (settings.search_keyword_extraction || 'direct')) return true;
      if (fullContentResults !== (settings.full_content_results ?? 3)) return true;
      if (searchResultsCount !== (settings.search_results_count ?? 6)) return true;
      if (showFreeOnly !== (settings.show_free_only ?? false)) return true;

      // Enabled Providers
      if (JSON.stringify(enabledProviders) !== JSON.stringify(settings.enabled_providers)) return true;
      if (JSON.stringify(directProviderToggles) !== JSON.stringify(settings.direct_provider_toggles)) return true;

      // Council Configuration (unified)
      if (JSON.stringify(councilModels) !== JSON.stringify(settings.council_models)) return true;
      if (chairmanModel !== settings.chairman_model) return true;
      if (councilTemperature !== (settings.council_temperature ?? 0.5)) return true;
      if (chairmanTemperature !== (settings.chairman_temperature ?? 0.4)) return true;
      if (stage2Temperature !== (settings.stage2_temperature ?? 0.3)) return true;
      if (stage3Temperature !== (settings.stage3_temperature ?? 0.5)) return true;
      if (stage5Temperature !== (settings.stage5_temperature ?? 0.4)) return true;

      // Remote/Local filters
      if (JSON.stringify(councilMemberFilters) !== JSON.stringify(settings.council_member_filters || {})) return true;
      if (chairmanFilter !== (settings.chairman_filter || 'remote')) return true;

      // Character Names and Member Prompts
      if (JSON.stringify(characterNames) !== JSON.stringify(settings.character_names || {})) return true;
      if (JSON.stringify(memberPrompts) !== JSON.stringify(settings.member_prompts || {})) return true;

      // Chairman settings
      if (chairmanCharacterName !== (settings.chairman_character_name || '')) return true;
      if (chairmanCustomPrompt !== (settings.chairman_custom_prompt || '')) return true;

      // Default Member Role
      if (defaultMemberRole !== (settings.default_member_role || '')) return true;

      // Prompts
      if (prompts.stage1_prompt !== settings.stage1_prompt) return true;
      if (prompts.stage2_prompt !== settings.stage2_prompt) return true;
      if (prompts.revision_prompt !== (settings.revision_prompt || '')) return true;
      if (prompts.stage3_prompt !== settings.stage3_prompt) return true;
      if (prompts.stage5_prompt !== (settings.stage5_prompt || '')) return true;
      if (prompts.debate_turn_primary_a_prompt !== (settings.debate_turn_primary_a_prompt || '')) return true;
      if (prompts.debate_turn_rebuttal_prompt !== (settings.debate_turn_rebuttal_prompt || '')) return true;
      if (prompts.debate_verdict_prompt !== (settings.debate_verdict_prompt || '')) return true;

      // Note: API keys are auto-saved on test, so we don't check them here

      return false;
    };

    setHasChanges(checkChanges());
  }, [
    settings,
    selectedSearchProvider,
    searchKeywordExtraction,
    fullContentResults,
    searchResultsCount,
    showFreeOnly,
    enabledProviders,
    directProviderToggles,
    councilModels,
    chairmanModel,
    councilTemperature,
    chairmanTemperature,
    stage2Temperature,
    stage3Temperature,
    stage5Temperature,
    councilMemberFilters,
    chairmanFilter,
    prompts,
    characterNames,
    memberPrompts,
    chairmanCharacterName,
    chairmanCustomPrompt,
    defaultMemberRole
  ]);

  // Helper to determine if filters need to switch based on availability
  const isRemoteAvailable = enabledProviders.openrouter || enabledProviders.direct || enabledProviders.groq || enabledProviders.custom;
  const isLocalAvailable = enabledProviders.ollama;

  const getNewFilter = (currentFilter) => {
    if (currentFilter === 'remote' && !isRemoteAvailable && isLocalAvailable) return 'local';
    if (currentFilter === 'local' && !isLocalAvailable && isRemoteAvailable) return 'remote';
    return currentFilter;
  };

  // Effect 1: Auto-update Council Member filters when providers change or members are added
  useEffect(() => {
    setCouncilMemberFilters(prev => {
      const next = { ...prev };
      let changed = false;
      // Check all council member indices
      for (let i = 0; i < councilModels.length; i++) {
        const currentFilter = next[i] || 'remote'; // Default is 'remote'
        const newFilter = getNewFilter(currentFilter);
        if (newFilter !== currentFilter) {
          next[i] = newFilter;
          changed = true;
          // Clear model if filter changed to force re-selection
          handleCouncilModelChange(i, '');
        }
      }
      return changed ? next : prev;
    });
  }, [enabledProviders, councilModels.length]);

  // Effect 2: Auto-update Chairman and Search filters when providers change
  // Note: We intentionally exclude councilModels.length to prevent resetting these when adding members
  useEffect(() => {
    // Update Chairman
    const newChairmanFilter = getNewFilter(chairmanFilter);
    if (newChairmanFilter !== chairmanFilter) {
      setChairmanFilter(newChairmanFilter);
      setChairmanModel('');
    }

  }, [enabledProviders, chairmanFilter]);

  // Effect 3: Sync enabledProviders.direct with directProviderToggles
  // If any direct provider is toggled on, ensure the master toggle is also on
  useEffect(() => {
    const anyDirectEnabled = Object.values(directProviderToggles).some(v => v);
    if (anyDirectEnabled && !enabledProviders.direct) {
      setEnabledProviders(prev => ({ ...prev, direct: true }));
    } else if (!anyDirectEnabled && enabledProviders.direct) {
      setEnabledProviders(prev => ({ ...prev, direct: false }));
    }
  }, [directProviderToggles, enabledProviders.direct]);

  // Effect 4: Load chat list when chat_management section is active
  useEffect(() => {
    if (activeSection === 'chat_management') {
      loadChatList();
    }
  }, [activeSection]);

  const loadChatList = async () => {
    setIsLoadingChatList(true);
    setChatManagementError(null);
    try {
      const conversations = await api.listConversations();
      setChatList(conversations);
      setSelectedChats(new Set()); // Clear selections on reload
    } catch (err) {
      setChatManagementError('Failed to load conversations');
    } finally {
      setIsLoadingChatList(false);
    }
  };

  const handleDeleteAll = async () => {
    setIsLoadingChatList(true);
    setChatManagementError(null);
    try {
      const result = await api.deleteAllConversations();
      setChatManagementSuccess(`Deleted ${result.count} conversation${result.count !== 1 ? 's' : ''}`);
      setChatList([]);
      setSelectedChats(new Set());
      setShowDeleteAllConfirm(false);
      onConversationsChange?.();
      setTimeout(() => setChatManagementSuccess(null), 3000);
    } catch (err) {
      setChatManagementError('Failed to delete all conversations');
    } finally {
      setIsLoadingChatList(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedChats.size === 0) return;
    setIsLoadingChatList(true);
    setChatManagementError(null);
    try {
      const result = await api.deleteSelectedConversations(Array.from(selectedChats));
      setChatManagementSuccess(`Deleted ${result.deleted} conversation${result.deleted !== 1 ? 's' : ''}`);
      setSelectedChats(new Set());
      setShowDeleteSelectedConfirm(false);
      await loadChatList(); // Refresh list
      onConversationsChange?.();
    } catch (err) {
      setChatManagementError('Failed to delete selected conversations');
    } finally {
      setIsLoadingChatList(false);
    }
  };

  const handleExportAll = async () => {
    setChatManagementError(null);
    try {
      const blob = await api.exportAllConversations();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `council-export-${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setChatManagementSuccess('Conversations exported successfully');
      setTimeout(() => setChatManagementSuccess(null), 3000);
    } catch (err) {
      setChatManagementError('Failed to export conversations');
    }
  };

  const toggleChatSelection = (chatId) => {
    setSelectedChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chatId)) {
        newSet.delete(chatId);
      } else {
        newSet.add(chatId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedChats.size === chatList.length) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(chatList.map(c => c.id)));
    }
  };

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();

      // Set settings immediately to show UI
      setSettings(data);

      setSelectedSearchProvider(data.search_provider || 'duckduckgo');
      setSelectedTruthCheckProvider(data.truth_check_provider || data.search_provider || 'duckduckgo');
      setSearchKeywordExtraction(data.search_keyword_extraction || 'direct');
      setFullContentResults(data.full_content_results ?? 3);
      setSearchResultsCount(data.search_results_count ?? 6);
      setShowFreeOnly(data.show_free_only ?? false);

      // Enabled Providers - use saved settings if available, otherwise auto-enable based on configured keys
      if (data.enabled_providers) {
        // Validate saved preferences against current API key status
        setEnabledProviders({
          openrouter: data.enabled_providers.openrouter && !!data.openrouter_api_key_set,
          ollama: data.enabled_providers.ollama,  // Skip validation - timing issue with async connection test
          groq: data.enabled_providers.groq && !!data.groq_api_key_set,
          direct: data.enabled_providers.direct,  // Master toggle - validity determined by children
          custom: data.enabled_providers.custom   // Key is optional
        });
      } else {
        // First time or no saved preferences - auto-enable based on what's configured
        const hasDirectConfigured = !!(data.openai_api_key_set || data.anthropic_api_key_set ||
          data.google_api_key_set || data.perplexity_api_key_set || data.mistral_api_key_set || data.deepseek_api_key_set);

        setEnabledProviders({
          openrouter: !!data.openrouter_api_key_set || (!hasDirectConfigured && !ollamaStatus?.connected && !data.groq_api_key_set),
          ollama: ollamaStatus?.connected || false,
          groq: !!data.groq_api_key_set,
          direct: hasDirectConfigured
        });
      }

      // Individual direct provider toggles - load from saved settings with validation
      if (data.direct_provider_toggles) {
        // Validate saved toggles against current API key status
        setDirectProviderToggles({
          openai: data.direct_provider_toggles.openai && !!data.openai_api_key_set,
          anthropic: data.direct_provider_toggles.anthropic && !!data.anthropic_api_key_set,
          google: data.direct_provider_toggles.google && !!data.google_api_key_set,
          perplexity: data.direct_provider_toggles.perplexity && !!data.perplexity_api_key_set,
          mistral: data.direct_provider_toggles.mistral && !!data.mistral_api_key_set,
          deepseek: data.direct_provider_toggles.deepseek && !!data.deepseek_api_key_set,
          glm: data.direct_provider_toggles.glm && !!data.glm_api_key_set,
          kimi: data.direct_provider_toggles.kimi && !!data.kimi_api_key_set
        });
      } else {
        // Fallback for first-time users: auto-enable if API key is configured
        setDirectProviderToggles({
          openai: !!data.openai_api_key_set,
          anthropic: !!data.anthropic_api_key_set,
          google: !!data.google_api_key_set,
          perplexity: !!data.perplexity_api_key_set,
          mistral: !!data.mistral_api_key_set,
          deepseek: !!data.deepseek_api_key_set,
          glm: !!data.glm_api_key_set,
          kimi: !!data.kimi_api_key_set
        });
      }

      // Council Configuration (unified)
      setCouncilModels(data.council_models || []);
      setChairmanModel(data.chairman_model || '');
      setCouncilTemperature(data.council_temperature ?? 0.5);
      setChairmanTemperature(data.chairman_temperature ?? 0.4);
      setStage2Temperature(data.stage2_temperature ?? 0.3);
      setStage3Temperature(data.stage3_temperature ?? 0.5);
      setStage5Temperature(data.stage5_temperature ?? 0.4);

      // Remote/Local filters - load from saved settings
      if (data.council_member_filters) {
        setCouncilMemberFilters(data.council_member_filters);
      }
      if (data.chairman_filter) {
        setChairmanFilter(data.chairman_filter);
      }

      // Character Names and Member Prompts
      setCharacterNames(data.character_names || {});
      setMemberPrompts(data.member_prompts || {});

      // Chairman Character Name and Custom Prompt
      setChairmanCharacterName(data.chairman_character_name || '');
      setChairmanCustomPrompt(data.chairman_custom_prompt || '');

      // Default Member Role
      setDefaultMemberRole(data.default_member_role || '');

      // Ollama Settings
      setOllamaBaseUrl(data.ollama_base_url || 'http://localhost:11434');

      // Custom Endpoint Settings
      if (data.custom_endpoint_name) setCustomEndpointName(data.custom_endpoint_name);
      if (data.custom_endpoint_url) setCustomEndpointUrl(data.custom_endpoint_url);
      // API key is not sent to frontend for security, similar to other keys

      // Prompts
      setPrompts({
        stage1_prompt: data.stage1_prompt || '',
        stage2_prompt: data.stage2_prompt || '',
        revision_prompt: data.revision_prompt || '',
        stage3_prompt: data.stage3_prompt || '',
        stage5_prompt: data.stage5_prompt || '',
        debate_turn_primary_a_prompt: data.debate_turn_primary_a_prompt || '',
        debate_turn_rebuttal_prompt: data.debate_turn_rebuttal_prompt || '',
        debate_verdict_prompt: data.debate_verdict_prompt || '',
      });

      // Clear Direct Keys (for security)
      setDirectKeys({
        openai_api_key: '',
        anthropic_api_key: '',
        google_api_key: '',
        perplexity_api_key: '',
        mistral_api_key: '',
        deepseek_api_key: '',
        glm_api_key: '',
        kimi_api_key: ''
      });
      setGroqApiKey(''); // Clear Groq key too

      // Load available models in background
      loadModels();
      loadOllamaModels(data.ollama_base_url || 'http://localhost:11434');
      if (data.custom_endpoint_url) {
        loadCustomEndpointModels();
      }

    } catch (err) {
      console.error("Error loading settings:", err);
      setError('Failed to load settings');
    }
  };

  const handleRefreshCouncil = async () => {
    if (onClearCouncilConfig) {
      await onClearCouncilConfig();
    }
    if (onNewDiscussion) {
      onNewDiscussion();
    }
    // Since we're already in Settings, just switch to council section
    setActiveSection('council');
  };

  const loadModels = async () => {
    setIsLoadingModels(true);
    try {
      const data = await api.getModels();
      if (data.models && data.models.length > 0) {
        // Sort models alphabetically
        const sorted = data.models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setAvailableModels(sorted);
      }

      // Fetch direct models from backend
      try {
        const directModels = await api.getDirectModels();
        setDirectAvailableModels(directModels);
      } catch (error) {
        console.error('Failed to fetch direct models:', error);
        // Fallback to empty list or basic models if fetch fails
        setDirectAvailableModels([]);
      }

    } catch (err) {
      console.warn('Failed to load models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const loadOllamaModels = async (baseUrl) => {
    try {
      const data = await api.getOllamaModels(baseUrl);
      if (data.models && data.models.length > 0) {
        // Sort models alphabetically
        const sorted = data.models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setOllamaAvailableModels(sorted);
      }
    } catch (err) {
      console.warn('Failed to load Ollama models:', err);
    }
  };

  const loadCustomEndpointModels = async () => {
    try {
      const data = await api.getCustomEndpointModels();
      if (data.models && data.models.length > 0) {
        const sorted = data.models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setCustomEndpointModels(sorted);
      }
    } catch (err) {
      console.warn('Failed to load custom endpoint models:', err);
    }
  };

  const handleTestCustomEndpoint = async () => {
    if (!customEndpointName || !customEndpointUrl) {
      setCustomEndpointTestResult({ success: false, message: 'Please enter a name and URL' });
      return;
    }
    setIsTestingCustomEndpoint(true);
    setCustomEndpointTestResult(null);
    try {
      const result = await api.testCustomEndpoint(customEndpointName, customEndpointUrl, customEndpointApiKey);
      setCustomEndpointTestResult(result);

      // Auto-save if connection succeeds
      if (result.success) {
        await api.updateSettings({
          custom_endpoint_name: customEndpointName,
          custom_endpoint_url: customEndpointUrl,
          custom_endpoint_api_key: customEndpointApiKey || null
        });
        // Reload settings to get the updated state
        const updatedSettings = await api.getSettings();
        setSettings(updatedSettings);
        // Load models from the new endpoint
        loadCustomEndpointModels();
      }
    } catch (err) {
      setCustomEndpointTestResult({ success: false, message: err.message });
    } finally {
      setIsTestingCustomEndpoint(false);
    }
  };

  const handleTestTavily = async () => {
    if (!tavilyApiKey && !settings.tavily_api_key_set) {
      setTavilyTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingTavily(true);
    setTavilyTestResult(null);
    try {
      // If input is empty but key is configured, pass null to test the saved key
      const keyToTest = tavilyApiKey || null;
      const result = await api.testTavilyKey(keyToTest);
      setTavilyTestResult(result);

      // Auto-save API key if validation succeeds and a new key was provided
      if (result.success && tavilyApiKey) {
        await api.updateSettings({ tavily_api_key: tavilyApiKey });
        setTavilyApiKey(''); // Clear input after save

        // Reload settings
        await loadSettings();

        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setTavilyTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingTavily(false);
    }
  };

  const handleTestBrave = async () => {
    if (!braveApiKey && !settings.brave_api_key_set) {
      setBraveTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingBrave(true);
    setBraveTestResult(null);
    try {
      // If input is empty but key is configured, pass null to test the saved key
      const keyToTest = braveApiKey || null;
      const result = await api.testBraveKey(keyToTest);
      setBraveTestResult(result);

      // Auto-save API key if validation succeeds and a new key was provided
      if (result.success && braveApiKey) {
        await api.updateSettings({ brave_api_key: braveApiKey });
        setBraveApiKey(''); // Clear input after save

        // Reload settings
        await loadSettings();

        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setBraveTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingBrave(false);
    }
  };

  const handleTestFirecrawl = async () => {
    if (!firecrawlApiKey && !settings.firecrawl_api_key_set) {
      setFirecrawlTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingFirecrawl(true);
    setFirecrawlTestResult(null);
    try {
      const keyToTest = firecrawlApiKey || null;
      const result = await api.testFirecrawlKey(keyToTest);
      setFirecrawlTestResult(result);
      if (result.success && firecrawlApiKey) {
        await api.updateSettings({ firecrawl_api_key: firecrawlApiKey });
        setFirecrawlApiKey('');
        await loadSettings();
      }
    } catch (e) {
      setFirecrawlTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingFirecrawl(false);
    }
  };

  const handleTestOpenRouter = async () => {
    if (!openrouterApiKey && !settings.openrouter_api_key_set) {
      setOpenrouterTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingOpenRouter(true);
    setOpenrouterTestResult(null);
    try {
      // If input is empty but key is configured, pass null to test the saved key
      const keyToTest = openrouterApiKey || null;
      const result = await api.testOpenRouterKey(keyToTest);
      setOpenrouterTestResult(result);

      // Auto-save API key if validation succeeds and a new key was provided
      if (result.success && openrouterApiKey) {
        await api.updateSettings({ openrouter_api_key: openrouterApiKey });
        setOpenrouterApiKey(''); // Clear input after save

        // Reload settings
        await loadSettings();

        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setOpenrouterTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingOpenRouter(false);
    }
  };

  const handleTestGroq = async () => {
    if (!groqApiKey && !settings.groq_api_key_set) {
      setGroqTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingGroq(true);
    setGroqTestResult(null);
    try {
      // If input is empty but key is configured, test with saved key via generic provider test
      // Note: backend/providers/groq.py must be registered with id 'groq'
      // Pass empty string if using stored key, backend will handle it
      const result = await api.testProviderKey('groq', groqApiKey || "");
      setGroqTestResult(result);

      // Auto-save API key if validation succeeds and a new key was provided
      if (result.success && groqApiKey) {
        await api.updateSettings({ groq_api_key: groqApiKey });
        setGroqApiKey(''); // Clear input after save

        // Reload settings
        await loadSettings();

        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setGroqTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingGroq(false);
    }
  };

  const handleTestOllama = async () => {
    setIsTestingOllama(true);
    setOllamaTestResult(null);
    try {
      const result = await api.testOllamaConnection(ollamaBaseUrl);
      setOllamaTestResult(result);

      // Always refresh parent component's ollama status (success or failure)
      if (onRefreshOllama) {
        onRefreshOllama(ollamaBaseUrl);
      }

      if (result.success) {
        // Auto-save base URL if connection succeeds
        await api.updateSettings({ ollama_base_url: ollamaBaseUrl });

        // Reload settings
        await loadSettings();

        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setOllamaTestResult({ success: false, message: 'Connection failed' });

      // Refresh parent status on exception too
      if (onRefreshOllama) {
        onRefreshOllama(ollamaBaseUrl);
      }
    } finally {
      setIsTestingOllama(false);
    }
  };

  const handleCouncilModelChange = (index, modelId) => {
    setCouncilModels(prev => {
      const updated = [...prev];
      updated[index] = modelId;
      return updated;
    });
  };



  const handleMemberFilterChange = (index, filter) => {
    setCouncilMemberFilters(prev => ({
      ...prev,
      [index]: filter
    }));

    // Clear the model selection for this member when switching filters
    setCouncilModels(prev => {
      const updated = [...prev];
      updated[index] = '';
      return updated;
    });
  };

  // Calculate Rate Limit Warning
  const getRateLimitWarning = () => {
    if (!settings || !availableModels || availableModels.length === 0) return null;

    let openRouterFreeCount = 0;

    const totalCouncilMembers = councilModels.length;
    let totalRequestsPerRun = (totalCouncilMembers * 2) + 2; // Stage 1, Stage 2, Chairman, Search Query

    // Check OpenRouter free models
    councilModels.forEach(modelId => {
      const isRemote = !modelId.includes(':') || modelId.startsWith('openrouter:');
      if (isRemote) {
        const modelData = availableModels.find(m => m.id === modelId || m.id === modelId.replace('openrouter:', ''));
        if (modelData && modelData.is_free) {
          openRouterFreeCount++;
        }
      }
    });

    // Check Chairman and Search Query Model
    const chairmanModelData = availableModels.find(m => m.id === chairmanModel || m.id === chairmanModel.replace('openrouter:', ''));
    if (chairmanModelData && chairmanModelData.is_free && (!chairmanModel.includes(':') || chairmanModel.startsWith('openrouter:'))) {
      openRouterFreeCount++;
    }

    // Logic for OpenRouter Warnings
    // OpenRouter: 20 RPM, 50 RPD (without credits)
    if (openRouterFreeCount > 0) {
      if (totalRequestsPerRun > 10 && openRouterFreeCount >= 3) { // 10 requests is approx half of 20 RPM
        return {
          type: 'error',
          title: 'High Rate Limit Risk (OpenRouter)',
          message: `Your council configuration generates ~${totalRequestsPerRun} requests per run, with ${openRouterFreeCount} free OpenRouter models. This may exceed the 20 requests/minute limit. Consider using Groq or Ollama for some members.`
        };
      } else if (openRouterFreeCount === totalRequestsPerRun) { // All requests from free OpenRouter
        return {
          type: 'warning',
          title: 'Daily Limit Caution (OpenRouter)',
          message: 'Free OpenRouter models are limited to 50 requests/day (without credits). Use Groq (14k/day) or Ollama for unlimited usage.'
        };
      }
    }

    // Logic for Groq Warnings
    // Groq: 30 RPM, 14,400 RPD (for Llama models)
    let groqRequests = 0;
    councilModels.forEach(id => {
      if (id.startsWith('groq:')) groqRequests += 2; // Stage 1 + Stage 2
    });
    if (chairmanModel.startsWith('groq:')) groqRequests += 1;

    if (groqRequests > 15) {
      return {
        type: 'warning',
        title: 'High Concurrency Caution (Groq)',
        message: `Your configuration uses ${groqRequests} Groq requests per run. The free tier limit is 30 requests/minute. You may experience throttling if you send messages quickly.`
      };
    }

    return null;
  };

  const rateLimitWarning = getRateLimitWarning();

  const handleFeelingLucky = () => {
    // 1. Get pool of available models respecting "Free Only" filter
    let candidateModels = filteredAvailableModels;

    if (!candidateModels || candidateModels.length === 0) {
      setError("No models available to randomize! Check your enabled providers.");
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Filter out models with known small context windows (< 8k) to prevent Stage 2 errors
    // Note: context_length might be undefined for some providers, we assume those are safe or unknown
    const safeModels = candidateModels.filter(m => !m.context_length || m.context_length >= 8192);

    // If we have enough safe models, use them. Otherwise fallback to all.
    if (safeModels.length >= 2) {
      candidateModels = safeModels;
    }

    // Helper to pick random item
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Helper to determine filter type (remote/local) from model ID
    const getFilterForModel = (modelId) => {
      return modelId.startsWith('ollama:') ? 'local' : 'remote';
    };

    // 2. Randomize Council Members (Unique if possible)
    let remainingModels = [...candidateModels];
    const newCouncilModels = [];
    const newMemberFilters = {};

    // We need to fill 'councilModels.length' slots
    for (let i = 0; i < councilModels.length; i++) {
      // If we ran out of unique models, refill the pool
      if (remainingModels.length === 0) {
        remainingModels = [...candidateModels];
      }

      const randomIndex = Math.floor(Math.random() * remainingModels.length);
      const selectedModel = remainingModels[randomIndex];

      newCouncilModels.push(selectedModel.id);
      newMemberFilters[i] = getFilterForModel(selectedModel.id);

      // Remove selected to avoid duplicates (until we run out)
      remainingModels.splice(randomIndex, 1);
    }

    // 3. Randomize Chairman
    const randomChairman = pickRandom(candidateModels);

    // Apply Updates
    setCouncilModels(newCouncilModels);
    setCouncilMemberFilters(newMemberFilters);

    setChairmanModel(randomChairman.id);
    setChairmanFilter(getFilterForModel(randomChairman.id));

    setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
  };

  const handleAddCouncilMember = () => {
    const newIndex = councilModels.length;

    // Determine best default filter based on what's available
    let defaultFilter = 'remote';
    const isRemoteAvailable = enabledProviders.openrouter || enabledProviders.direct || enabledProviders.groq || enabledProviders.custom;
    const isLocalAvailable = enabledProviders.ollama && ollamaAvailableModels.length > 0;

    if (!isRemoteAvailable && isLocalAvailable) {
      defaultFilter = 'local';
    }

    // Get models for the chosen filter
    const filtered = filterByRemoteLocal(filteredAvailableModels, defaultFilter);

    // Even if no models found, we should allow adding the slot so user can switch filter/provider
    // But we try to pick a default if possible
    const defaultModel = filtered.length > 0 ? filtered[0].id : '';

    setCouncilModels(prev => [...prev, defaultModel]);

    // Initialize filter for new member
    setCouncilMemberFilters(prev => ({
      ...prev,
      [newIndex]: defaultFilter
    }));
  };

  const handleRemoveCouncilMember = (index) => {
    setCouncilModels(prev => prev.filter((_, i) => i !== index));
    // Clean up filters - shift indices down
    setCouncilMemberFilters(prev => {
      const newFilters = {};
      Object.keys(prev).forEach(key => {
        const idx = parseInt(key);
        if (idx < index) {
          newFilters[idx] = prev[idx];
        } else if (idx > index) {
          newFilters[idx - 1] = prev[idx];
        }
      });
      return newFilters;
    });

    // Clean up character names - shift indices down
    setCharacterNames(prev => {
      const newNames = {};
      Object.keys(prev).forEach(key => {
        const idx = parseInt(key);
        if (idx < index) {
          newNames[idx] = prev[key];
        } else if (idx > index) {
          newNames[idx - 1] = prev[key];
        }
      });
      return newNames;
    });

    // Clean up member prompts - shift indices down
    setMemberPrompts(prev => {
      const newPrompts = {};
      Object.keys(prev).forEach(key => {
        const idx = parseInt(key);
        if (idx < index) {
          newPrompts[idx] = prev[key];
        } else if (idx > index) {
          newPrompts[idx - 1] = prev[key];
        }
      });
      return newPrompts;
    });
  };

  const handlePromptChange = (key, value) => {
    setPrompts(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleResetPrompt = async (key) => {
    try {
      const defaults = await api.getDefaultSettings();
      console.log('Defaults fetched:', defaults);
      if (defaults[key] !== undefined) {
        handlePromptChange(key, defaults[key]);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        console.warn(`Default for key ${key} not found in defaults`, defaults);
      }
    } catch (err) {
      console.error("Failed to fetch default prompt", err);
      setError("Failed to reset prompt");
    }
  };

  const handleResetToDefaults = () => {
    setShowResetConfirm(true);
  };

  const confirmResetToDefaults = async () => {
    setShowResetConfirm(false);

    try {
      // 1. Disable all providers
      setEnabledProviders({
        openrouter: false,
        ollama: false,
        groq: false,
        direct: false
      });

      setDirectProviderToggles({
        openai: false,
        anthropic: false,
        google: false,
        perplexity: false,
        mistral: false,
        deepseek: false,
        glm: false,
        kimi: false
      });

      // 2. Reset Models to "Blank Slate" (User must select)
      // Initialize with 2 empty slots for council
      setCouncilModels(['', '']);
      setChairmanModel('');
      setCouncilTemperature(0.5);
      setChairmanTemperature(0.4);
      setStage2Temperature(0.3);
      setStage3Temperature(0.5);
      setStage5Temperature(0.4);

      // Reset filters to 'remote' default
      // Reset filters to 'remote' default
      setCouncilMemberFilters({ 0: 'remote', 1: 'remote' });
      setChairmanFilter('remote');

      // Reset Character Names and Member Prompts
      setCharacterNames({});
      setMemberPrompts({});
      setChairmanCharacterName('');
      setChairmanCustomPrompt('');

      // Reset Default Member Role
      setDefaultMemberRole('You are a helpful assistant.');

      // 3. General Settings Defaults
      setSelectedSearchProvider('duckduckgo');
      setSearchKeywordExtraction('direct');
      setFullContentResults(3);
      setShowFreeOnly(false);
      setOllamaBaseUrl('http://localhost:11434');

      // 4. Reset Prompts to System Defaults (keep these useful)
      const defaults = await api.getDefaultSettings();
      setPrompts({
        stage1_prompt: defaults.stage1_prompt,
        stage2_prompt: defaults.stage2_prompt,
        revision_prompt: defaults.revision_prompt,
        stage3_prompt: defaults.stage3_prompt,
        stage5_prompt: defaults.stage5_prompt,
        debate_turn_primary_a_prompt: defaults.debate_turn_primary_a_prompt || '',
        debate_turn_rebuttal_prompt: defaults.debate_turn_rebuttal_prompt || '',
        debate_verdict_prompt: defaults.debate_verdict_prompt || '',
      });

      // 5. Save the reset settings to backend
      const updates = {
        search_provider: 'duckduckgo',
        search_results_count: 6,
        full_content_results: 3,
        enabled_providers: {
          openrouter: false,
          ollama: false,
          groq: false,
          direct: false
        },
        direct_provider_toggles: {
          openai: false,
          anthropic: false,
          google: false,
          perplexity: false,
          mistral: false,
          deepseek: false,
          glm: false,
          kimi: false
        },
        council_models: ['', ''],
        chairman_model: '',
        council_temperature: 0.5,
        chairman_temperature: 0.4,
        stage2_temperature: 0.3,
        stage3_temperature: 0.5,
        stage5_temperature: 0.4,
        search_query_model: '',
        council_member_filters: { 0: 'remote', 1: 'remote' },
        chairman_filter: 'remote',
        search_query_filter: 'remote',
        character_names: null,
        member_prompts: null,
        chairman_character_name: null,
        chairman_custom_prompt: null,
        default_member_role: 'You are a helpful assistant.',
        stage1_prompt: defaults.stage1_prompt,
        stage2_prompt: defaults.stage2_prompt,
        revision_prompt: defaults.revision_prompt,
        stage3_prompt: defaults.stage3_prompt,
        stage5_prompt: defaults.stage5_prompt,
        debate_turn_primary_a_prompt: defaults.debate_turn_primary_a_prompt,
        debate_turn_rebuttal_prompt: defaults.debate_turn_rebuttal_prompt,
        debate_verdict_prompt: defaults.debate_verdict_prompt,
      };
      await api.updateSettings(updates);

      setSuccess(true);
      // Navigate to Council Config so user sees the blank state
      setActiveSection('council');

      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to reset settings');
    }
  };

  const handleTestDirectKey = async (providerId, keyField) => {
    const apiKey = directKeys[keyField];
    // Allow if key is entered OR if it's already set (Retest mode)
    if (!apiKey && !settings?.[`${keyField}_set`]) return;

    setValidatingKeys(prev => ({ ...prev, [providerId]: true }));
    setKeyValidationStatus(prev => ({ ...prev, [providerId]: null }));

    try {
      // Pass empty string if using stored key, backend will handle it
      const result = await api.testProviderKey(providerId, apiKey || "");
      setKeyValidationStatus(prev => ({
        ...prev,
        [providerId]: {
          success: result.success,
          message: result.message
        }
      }));

      // Auto-save API key if validation succeeds AND it was a new key
      if (result.success && apiKey) {
        await api.updateSettings({ [keyField]: apiKey });
        setDirectKeys(prev => ({ ...prev, [keyField]: '' })); // Clear input after save

        // Reload settings
        await loadSettings();

        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setKeyValidationStatus(prev => ({
        ...prev,
        [providerId]: {
          success: false,
          message: err.message
        }
      }));
    } finally {
      setValidatingKeys(prev => ({ ...prev, [providerId]: false }));
    }
  };

  // Clear API key handlers
  const handleClearOpenRouterKey = async () => {
    try {
      await api.updateSettings({ openrouter_api_key: null });
      setOpenrouterTestResult(null);
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to clear API key');
    }
  };

  const handleClearGroqKey = async () => {
    try {
      await api.updateSettings({ groq_api_key: null });
      setGroqTestResult(null);
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to clear API key');
    }
  };

  const handleClearOllamaUrl = async () => {
    try {
      await api.updateSettings({ ollama_base_url: 'http://localhost:11434' });
      setOllamaBaseUrl('http://localhost:11434');
      setOllamaTestResult(null);
      if (onRefreshOllama) {
        onRefreshOllama('http://localhost:11434');
      }
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to reset Ollama URL');
    }
  };

  const handleClearDirectKey = async (keyField) => {
    try {
      await api.updateSettings({ [keyField]: null });
      setKeyValidationStatus(prev => {
        const updated = { ...prev };
        // Find provider ID for this key field and clear its status
        const providerMap = {
          openai_api_key: 'openai',
          anthropic_api_key: 'anthropic',
          google_api_key: 'google',
          perplexity_api_key: 'perplexity',
          mistral_api_key: 'mistral',
          deepseek_api_key: 'deepseek',
          glm_api_key: 'glm',
          kimi_api_key: 'kimi'
        };
        const providerId = providerMap[keyField];
        if (providerId) {
          delete updated[providerId];
        }
        return updated;
      });
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to clear API key');
    }
  };

  const handleClearCustomEndpoint = async () => {
    try {
      await api.updateSettings({
        custom_endpoint_name: null,
        custom_endpoint_url: null,
        custom_endpoint_api_key: null
      });
      setCustomEndpointName('');
      setCustomEndpointUrl('');
      setCustomEndpointApiKey('');
      setCustomEndpointTestResult(null);
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to clear custom endpoint');
    }
  };

  const handleClearTavilyKey = async () => {
    try {
      await api.updateSettings({ tavily_api_key: null });
      setTavilyTestResult(null);
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to clear API key');
    }
  };

  const handleClearBraveKey = async () => {
    try {
      await api.updateSettings({ brave_api_key: null });
      setBraveTestResult(null);
      await loadSettings();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to clear API key');
    }
  };

  const handleClearFirecrawlKey = async () => {
    try {
      await api.updateSettings({ firecrawl_api_key: null });
      setFirecrawlTestResult(null);
      await loadSettings();
      setSuccess(true);
    } catch (e) { /* ignore */ }
  };


  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const updates = {
        search_provider: selectedSearchProvider,
        search_keyword_extraction: searchKeywordExtraction,
        search_results_count: searchResultsCount,
        full_content_results: fullContentResults,
        show_free_only: showFreeOnly,

        // Enabled Providers
        enabled_providers: enabledProviders,
        direct_provider_toggles: directProviderToggles,

        // Council Configuration (unified)
        council_models: councilModels,
        chairman_model: chairmanModel,
        council_temperature: councilTemperature,
        chairman_temperature: chairmanTemperature,
        stage2_temperature: stage2Temperature,
        stage3_temperature: stage3Temperature,
        stage5_temperature: stage5Temperature,

        // Remote/Local filters for each selection
        council_member_filters: councilMemberFilters,
        chairman_filter: chairmanFilter,

        // Character Names and Member Prompts
        character_names: Object.keys(characterNames).length > 0 ? characterNames : null,
        member_prompts: Object.keys(memberPrompts).length > 0 ? memberPrompts : null,

        // Chairman Character Name and Custom Prompt
        chairman_character_name: chairmanCharacterName || null,
        chairman_custom_prompt: chairmanCustomPrompt || null,

        // Default Member Role
        default_member_role: defaultMemberRole || null,

        // Prompts
        ...prompts
      };

      // Only send API keys if they've been changed
      if (tavilyApiKey && !tavilyApiKey.startsWith('•')) {
        updates.tavily_api_key = tavilyApiKey;
      }
      if (braveApiKey && !braveApiKey.startsWith('•')) {
        updates.brave_api_key = braveApiKey;
      }
      if (openrouterApiKey && !openrouterApiKey.startsWith('•')) {
        updates.openrouter_api_key = openrouterApiKey;
      }
      if (groqApiKey && !groqApiKey.startsWith('•')) {
        updates.groq_api_key = groqApiKey;
      }

      // Add Direct Provider Keys
      Object.entries(directKeys).forEach(([key, value]) => {
        if (value && !value.startsWith('•')) {
          updates[key] = value;
        }
      });

      await api.updateSettings(updates);
      setSuccess(true);
      setTavilyApiKey('');
      setBraveApiKey('');
      setFirecrawlApiKey('');
      setOpenrouterApiKey('');

      await loadSettings();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper function to check if a direct provider is configured
  const isDirectProviderConfigured = (providerName) => {
    switch (providerName) {
      case 'OpenAI': return !!(directKeys.openai_api_key || settings?.openai_api_key_set);
      case 'Anthropic': return !!(directKeys.anthropic_api_key || settings?.anthropic_api_key_set);
      case 'Google': return !!(directKeys.google_api_key || settings?.google_api_key_set);
      case 'Perplexity': return !!(directKeys.perplexity_api_key || settings?.perplexity_api_key_set);
      case 'Mistral': return !!(directKeys.mistral_api_key || settings?.mistral_api_key_set);
      case 'DeepSeek': return !!(directKeys.deepseek_api_key || settings?.deepseek_api_key_set);
      case 'GLM': return !!(directKeys.glm_api_key || settings?.glm_api_key_set);
      case 'Kimi': return !!(directKeys.kimi_api_key || settings?.kimi_api_key_set);
      default: return false;
    }
  };

  // Get all available models from all sources
  const getAllAvailableModels = () => {
    const models = [];

    // Add OpenRouter models if enabled
    if (enabledProviders.openrouter) {
      models.push(...availableModels);
    }

    // Add Ollama models if enabled
    if (enabledProviders.ollama) {
      models.push(...ollamaAvailableModels.map(m => ({
        ...m,
        id: `ollama:${m.id}`,
        name: `${m.name || m.id} (Local)`,
        provider: 'Ollama'
      })));
    }

    // Add Groq models if enabled
    if (enabledProviders.groq) {
      const groqModels = directAvailableModels.filter(m => m.provider === 'Groq');
      models.push(...groqModels);
    }

    // Add direct provider models if master toggle is enabled AND individual provider is enabled
    if (enabledProviders.direct) {
      const filteredDirectModels = directAvailableModels.filter(m => {
        if (m.provider === 'Groq') return false; // Handled separately above
        const providerKey = m.provider.toLowerCase();
        const individualToggleEnabled = directProviderToggles[providerKey];
        const providerConfigured = isDirectProviderConfigured(m.provider);
        return individualToggleEnabled && providerConfigured;
      });
      models.push(...filteredDirectModels);
    }

    // Add custom endpoint models if enabled and configured
    if (enabledProviders.custom && customEndpointModels.length > 0) {
      models.push(...customEndpointModels);
    }

    // Deduplicate by model ID (prefer direct connections over OpenRouter for same model)
    // Since direct models are added last, always set to overwrite earlier entries
    const uniqueModels = new Map();
    models.forEach(model => {
      uniqueModels.set(model.id, model);
    });

    return Array.from(uniqueModels.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  };

  // Get filtered models for council member selection (respects free filter)
  const getFilteredAvailableModels = () => {
    const all = getAllAvailableModels();
    if (!showFreeOnly) return all;

    // Filter logic:
    // 1. If it's an OpenRouter model, checks if it's free.
    // 2. If it's NOT OpenRouter (Direct, Ollama, Custom), keep it visible.
    return all.filter(m => {
      // Check if it's an OpenRouter model
      const isOpenRouter = m.source === 'openrouter' || m.provider === 'OpenRouter' || m.id.startsWith('openrouter:') || m.id.includes('/');

      // If it is OpenRouter, apply the free filter
      if (isOpenRouter) {
        return m.is_free;
      }

      // Otherwise (Direct, Ollama, Custom), always show
      return true;
    });
  };

  // Memoized model lists to prevent stale state reads during rapid toggle changes
  const allAvailableModels = useMemo(() => {
    return getAllAvailableModels();
  }, [
    enabledProviders,
    directProviderToggles,
    availableModels,
    ollamaAvailableModels,
    directAvailableModels,
    customEndpointModels,
    settings
  ]);

  const filteredAvailableModels = useMemo(() => {
    return getFilteredAvailableModels();
  }, [
    enabledProviders,
    directProviderToggles,
    availableModels,
    ollamaAvailableModels,
    directAvailableModels,
    customEndpointModels,
    showFreeOnly,
    settings
  ]);

  // Filter models by remote/local for specific use case
  const filterByRemoteLocal = (models, filter) => {
    if (filter === 'local') {
      // Only Ollama models
      return models.filter(m => m.id.startsWith('ollama:'));
    } else {
      // Remote: OpenRouter + Direct providers (exclude Ollama)
      return models.filter(m => !m.id.startsWith('ollama:'));
    }
  };

  if (!settings) {
    return (
      <div className="settings-overlay">
        <div className="settings-modal">
          <div className="settings-loading">Loading settings...</div>
        </div>
      </div>
    );
  }





  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-body">
          {/* Sidebar Navigation */}
          <div className="settings-sidebar">
            <button
              className={`sidebar-nav-item ${activeSection === 'llm_keys' ? 'active' : ''}`}
              onClick={() => setActiveSection('llm_keys')}
            >
              LLM API Keys
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'council' ? 'active' : ''}`}
              onClick={() => setActiveSection('council')}
            >
              Council Config
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'presets' ? 'active' : ''}`}
              onClick={() => setActiveSection('presets')}
            >
              Council Presets
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'prompts' ? 'active' : ''}`}
              onClick={() => setActiveSection('prompts')}
            >
              System Prompts
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'search' ? 'active' : ''}`}
              onClick={() => setActiveSection('search')}
            >
              Search Providers
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'truth_check' ? 'active' : ''}`}
              onClick={() => setActiveSection('truth_check')}
            >
              Truth Check
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'chat_management' ? 'active' : ''}`}
              onClick={() => setActiveSection('chat_management')}
            >
              Chat Management
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'dictation' ? 'active' : ''}`}
              onClick={() => setActiveSection('dictation')}
            >
              Dictation
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'import_export' ? 'active' : ''}`}
              onClick={() => setActiveSection('import_export')}
            >
              Reset
            </button>
            <button
              className={`sidebar-nav-item ${activeSection === 'credits' ? 'active' : ''}`}
              onClick={() => setActiveSection('credits')}
            >
              Credits
            </button>
          </div>

          {/* Main Content Area */}
          <div className="settings-main-panel">

            {/* API KEYS (LLM API Keys) */}
            {activeSection === 'llm_keys' && (
              <ProviderSettings
                settings={settings}
                // OpenRouter
                openrouterApiKey={openrouterApiKey}
                setOpenrouterApiKey={(val) => { setOpenrouterApiKey(val); setOpenrouterTestResult(null); }}
                handleTestOpenRouter={handleTestOpenRouter}
                isTestingOpenRouter={isTestingOpenRouter}
                openrouterTestResult={openrouterTestResult}
                handleClearOpenRouterKey={handleClearOpenRouterKey}
                // Groq
                groqApiKey={groqApiKey}
                setGroqApiKey={(val) => { setGroqApiKey(val); setGroqTestResult(null); }}
                handleTestGroq={handleTestGroq}
                isTestingGroq={isTestingGroq}
                groqTestResult={groqTestResult}
                handleClearGroqKey={handleClearGroqKey}
                // Ollama
                ollamaBaseUrl={ollamaBaseUrl}
                setOllamaBaseUrl={(val) => { setOllamaBaseUrl(val); setOllamaTestResult(null); }}
                handleTestOllama={handleTestOllama}
                isTestingOllama={isTestingOllama}
                ollamaTestResult={ollamaTestResult}
                ollamaStatus={ollamaStatus}
                loadOllamaModels={loadOllamaModels}
                handleClearOllamaUrl={handleClearOllamaUrl}
                // Direct
                directKeys={directKeys}
                setDirectKeys={setDirectKeys}
                handleTestDirectKey={handleTestDirectKey}
                validatingKeys={validatingKeys}
                keyValidationStatus={keyValidationStatus}
                handleClearDirectKey={handleClearDirectKey}
                // Custom Endpoint
                customEndpointName={customEndpointName}
                setCustomEndpointName={(val) => { setCustomEndpointName(val); setCustomEndpointTestResult(null); }}
                customEndpointUrl={customEndpointUrl}
                setCustomEndpointUrl={(val) => { setCustomEndpointUrl(val); setCustomEndpointTestResult(null); }}
                customEndpointApiKey={customEndpointApiKey}
                setCustomEndpointApiKey={(val) => { setCustomEndpointApiKey(val); setCustomEndpointTestResult(null); }}
                handleTestCustomEndpoint={handleTestCustomEndpoint}
                isTestingCustomEndpoint={isTestingCustomEndpoint}
                customEndpointTestResult={customEndpointTestResult}
                customEndpointModels={customEndpointModels}
                handleClearCustomEndpoint={handleClearCustomEndpoint}
              />
            )}

            {/* COUNCIL CONFIGURATION */}
            {activeSection === 'council' && (
              <CouncilConfig
                settings={settings}
                // API key status for toggle disable logic
                apiKeysConfigured={{
                  openrouter: settings?.openrouter_api_key_set || false,
                  groq: settings?.groq_api_key_set || false,
                  openai: settings?.openai_api_key_set || false,
                  anthropic: settings?.anthropic_api_key_set || false,
                  google: settings?.google_api_key_set || false,
                  perplexity: settings?.perplexity_api_key_set || false,
                  mistral: settings?.mistral_api_key_set || false,
                  deepseek: settings?.deepseek_api_key_set || false,
                  glm: settings?.glm_api_key_set || false,
                  kimi: settings?.kimi_api_key_set || false,
                }}
                ollamaConnected={ollamaStatus?.connected || false}
                // State
                enabledProviders={enabledProviders}
                setEnabledProviders={setEnabledProviders}
                directProviderToggles={directProviderToggles}
                setDirectProviderToggles={setDirectProviderToggles}
                showFreeOnly={showFreeOnly}
                setShowFreeOnly={setShowFreeOnly}
                isLoadingModels={isLoadingModels}
                rateLimitWarning={rateLimitWarning}
                councilModels={councilModels}
                councilMemberFilters={councilMemberFilters}
                chairmanModel={chairmanModel}
                setChairmanModel={setChairmanModel}
                chairmanFilter={chairmanFilter}
                setChairmanFilter={setChairmanFilter}
                councilTemperature={councilTemperature}
                setCouncilTemperature={setCouncilTemperature}
                chairmanTemperature={chairmanTemperature}
                setChairmanTemperature={setChairmanTemperature}
                characterNames={characterNames}
                setCharacterNames={setCharacterNames}
                memberPrompts={memberPrompts}
                setMemberPrompts={setMemberPrompts}
                // Chairman identity
                chairmanCharacterName={chairmanCharacterName}
                setChairmanCharacterName={setChairmanCharacterName}
                chairmanCustomPrompt={chairmanCustomPrompt}
                setChairmanCustomPrompt={setChairmanCustomPrompt}
                // Additional config for presets
                stage2Temperature={stage2Temperature}
                executionMode={settings?.execution_mode || 'full'}
                webSearchEnabled={settings?.web_search_enabled ?? true}
                searchProvider={selectedSearchProvider}
                // Preset callback
                onPresetsChange={onPresetsChange}
                // Data
                allModels={allAvailableModels}
                filteredModels={filteredAvailableModels}
                ollamaAvailableModels={ollamaAvailableModels}
                customEndpointName={customEndpointName}
                customEndpointUrl={customEndpointUrl}
                // Callbacks
                handleFeelingLucky={handleFeelingLucky}
                handleMemberFilterChange={handleMemberFilterChange}
                handleCouncilModelChange={handleCouncilModelChange}
                handleRemoveCouncilMember={handleRemoveCouncilMember}
                handleAddCouncilMember={handleAddCouncilMember}
                setActiveSection={setActiveSection}
                setActivePromptTab={setActivePromptTab}
                isFrozen={isFrozen}
                onNewDiscussion={onNewDiscussion}
              />
            )}

            {/* COUNCIL PRESETS */}
            {activeSection === 'presets' && (
              <PresetSettings
                // Current config to save
                councilModels={councilModels}
                chairmanModel={chairmanModel}
                councilTemperature={councilTemperature}
                chairmanTemperature={chairmanTemperature}
                stage2Temperature={stage2Temperature}
                characterNames={characterNames}
                memberPrompts={memberPrompts}
                chairmanCharacterName={chairmanCharacterName}
                chairmanCustomPrompt={chairmanCustomPrompt}
                executionMode={settings?.execution_mode || 'full'}
                webSearchEnabled={settings?.web_search_enabled ?? true}
                searchProvider={settings?.search_provider || 'duckduckgo'}
                // Provider toggles to save/restore
                enabledProviders={enabledProviders}
                directProviderToggles={directProviderToggles}
                // Provider restoration callback with credential validation
                // Returns filtered values for immediate use (avoids async state issues)
                onLoadProviders={(providers, directToggles, warnings) => {
                  // Only enable providers that have required credentials
                  // This prevents confusing "enabled but broken" state
                  const canEnableProvider = (provider) => {
                    switch (provider) {
                      case 'openrouter': return settings?.openrouter_api_key_set;
                      case 'groq': return settings?.groq_api_key_set;
                      case 'ollama': return ollamaStatus?.connected;
                      case 'custom': return true; // Key is optional
                      default: return true;
                    }
                  };

                  const canEnableDirectProvider = (provider) => {
                    const keyField = `${provider}_api_key_set`;
                    return settings?.[keyField] ?? false;
                  };

                  let filteredProviders = {};
                  let filteredDirect = {};

                  if (providers) {
                    Object.entries(providers).forEach(([key, value]) => {
                      if (value && canEnableProvider(key)) {
                        filteredProviders[key] = true;
                      } else if (value && !canEnableProvider(key)) {
                        const providerName = key.charAt(0).toUpperCase() + key.slice(1);
                        warnings.push(`${providerName} requires API key configuration`);
                      }
                      // If value is false, don't add to filteredProviders (provider stays disabled)
                    });
                    setEnabledProviders(filteredProviders);
                  }

                  if (directToggles) {
                    Object.entries(directToggles).forEach(([key, value]) => {
                      if (value && canEnableDirectProvider(key)) {
                        filteredDirect[key] = true;
                      } else if (value && !canEnableDirectProvider(key)) {
                        const providerName = key.charAt(0).toUpperCase() + key.slice(1);
                        warnings.push(`${providerName} requires API key configuration`);
                      }
                      // If value is false, don't add to filteredDirect (provider stays disabled)
                    });
                    setDirectProviderToggles(filteredDirect);
                  }

                  // Return filtered values so caller can use them immediately
                  // (React state updates are async, so we can't rely on state variables)
                  return { enabledProviders: filteredProviders, directProviderToggles: filteredDirect };
                }}
                // Callback to apply loaded preset
                // filteredToggles comes from onLoadProviders return value (avoids async state issues)
                onLoadPreset={async (config, warnings, filteredToggles) => {
                  // Apply each field from the preset to local state
                  if (config.council_models) setCouncilModels(config.council_models);
                  if (config.chairman_model) setChairmanModel(config.chairman_model);
                  if (config.council_temperature !== undefined) setCouncilTemperature(config.council_temperature);
                  if (config.chairman_temperature !== undefined) setChairmanTemperature(config.chairman_temperature);
                  if (config.stage2_temperature !== undefined) setStage2Temperature(config.stage2_temperature);
                  if (config.character_names) setCharacterNames(config.character_names);
                  if (config.member_prompts) setMemberPrompts(config.member_prompts);
                  if (config.chairman_character_name !== undefined) setChairmanCharacterName(config.chairman_character_name);
                  if (config.chairman_custom_prompt !== undefined) setChairmanCustomPrompt(config.chairman_custom_prompt);
                  if (config.search_provider) setSelectedSearchProvider(config.search_provider);

                  // Save directly to backend (can't wait for state updates)
                  try {
                    const payload = {
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
                      // CRITICAL: Save provider toggles so loadSettings() doesn't overwrite them
                      // Use filteredToggles parameter (not state variables) because React state is async
                      enabled_providers: filteredToggles?.enabledProviders || enabledProviders,
                      direct_provider_toggles: filteredToggles?.directProviderToggles || directProviderToggles,
                    };
                    await api.updateSettings(payload);

                    // Reload settings to sync local state with backend
                    await loadSettings();

                    // Show success feedback
                    if (warnings && warnings.length > 0) {
                      setError(`Preset loaded with warnings: ${warnings.join(', ')}`);
                    } else {
                      setSuccessMessage('Preset loaded and settings saved!');
                      setSuccess(true);
                      setTimeout(() => {
                        setSuccess(false);
                        setSuccessMessage(null);
                      }, 3000);
                    }
                  } catch (err) {
                    setError('Failed to save preset settings');
                  }

                  // Navigate to Council Config so user can see the changes
                  setActiveSection('council');
                }}
                // Callback when presets change (save/delete)
                onPresetsChange={onPresetsChange}
                // Frozen state
                isFrozen={isFrozen}
                onNewDiscussion={onNewDiscussion}
              />
            )}

            {/* SYSTEM PROMPTS */}
            {activeSection === 'prompts' && (
              <PromptSettings
                prompts={prompts}
                handlePromptChange={handlePromptChange}
                handleResetPrompt={handleResetPrompt}
                activePromptTab={activePromptTab}
                setActivePromptTab={setActivePromptTab}
                stage2Temperature={stage2Temperature}
                setStage2Temperature={setStage2Temperature}
                stage3Temperature={stage3Temperature}
                setStage3Temperature={setStage3Temperature}
                stage5Temperature={stage5Temperature}
                setStage5Temperature={setStage5Temperature}
                defaultMemberRole={defaultMemberRole}
                setDefaultMemberRole={setDefaultMemberRole}
              />
            )}

            {/* SEARCH PROVIDERS (New Section) */}
            {activeSection === 'search' && (
              <SearchSettings
                settings={settings}
                selectedSearchProvider={selectedSearchProvider}
                setSelectedSearchProvider={setSelectedSearchProvider}
                // Tavily
                tavilyApiKey={tavilyApiKey}
                setTavilyApiKey={setTavilyApiKey}
                handleTestTavily={handleTestTavily}
                isTestingTavily={isTestingTavily}
                tavilyTestResult={tavilyTestResult}
                setTavilyTestResult={setTavilyTestResult}
                handleClearTavilyKey={handleClearTavilyKey}
                // Brave
                braveApiKey={braveApiKey}
                setBraveApiKey={setBraveApiKey}
                handleTestBrave={handleTestBrave}
                isTestingBrave={isTestingBrave}
                braveTestResult={braveTestResult}
                setBraveTestResult={setBraveTestResult}
                handleClearBraveKey={handleClearBraveKey}
                // Firecrawl
                firecrawlApiKey={firecrawlApiKey}
                setFirecrawlApiKey={setFirecrawlApiKey}
                handleTestFirecrawl={handleTestFirecrawl}
                isTestingFirecrawl={isTestingFirecrawl}
                firecrawlTestResult={firecrawlTestResult}
                setFirecrawlTestResult={setFirecrawlTestResult}
                handleClearFirecrawlKey={handleClearFirecrawlKey}
                // Other Settings
                fullContentResults={fullContentResults}
                setFullContentResults={setFullContentResults}
                searchResultsCount={searchResultsCount}
                setSearchResultsCount={setSearchResultsCount}
                searchKeywordExtraction={searchKeywordExtraction}
                setSearchKeywordExtraction={setSearchKeywordExtraction}
              />
            )}

            {/* TRUTH CHECK */}
            {activeSection === 'truth_check' && (
              <TruthCheckSettings
                selectedProvider={selectedTruthCheckProvider}
                setSelectedProvider={handleTruthCheckProviderChange}
                hasTavilyKey={settings?.tavily_api_key_set}
                hasBraveKey={settings?.brave_api_key_set}
              />
            )}

            {/* RESET SECTION */}
            {activeSection === 'import_export' && (
              <section className="settings-section">
                <h3>Reset</h3>
                <div className="subsection">
                  <h4 style={{ color: '#f87171' }}>Danger Zone</h4>
                  <p className="section-description">
                    Reset all settings to their default values. This will clear your council selection and custom prompts.
                    API keys will be preserved.
                  </p>
                  <button
                    className="reset-button"
                    type="button"
                    onClick={handleResetToDefaults}
                    style={{ marginTop: '10px' }}
                  >
                    Reset to Defaults
                  </button>
                </div>
              </section>
            )}

            {/* CHAT MANAGEMENT */}
            {activeSection === 'chat_management' && (
              <section className="settings-section">
                <h3>Chat Management</h3>
                <p className="section-description">
                  Export, delete, or manage your conversation history.
                </p>

                {/* Feedback Messages */}
                {chatManagementError && (
                  <div className="test-result error" style={{ marginBottom: '16px' }}>
                    {chatManagementError}
                  </div>
                )}

                {/* Export All */}
                <div className="subsection" style={{ marginBottom: '24px' }}>
                  <h4 style={{ marginBottom: '12px' }}>Export Conversations</h4>
                  <p className="subsection-description">
                    Download all your conversations as a single Markdown file.
                  </p>
                  <button
                    className="action-btn"
                    onClick={handleExportAll}
                    disabled={isLoadingChatList || chatList.length === 0}
                  >
                    Export All ({chatList.length} conversation{chatList.length !== 1 ? 's' : ''})
                  </button>
                  {chatManagementSuccess && (
                    <div className="test-result success" style={{ marginTop: '12px' }}>
                      {chatManagementSuccess}
                    </div>
                  )}
                </div>

                {/* Selective Delete */}
                <div className="subsection" style={{ marginBottom: '24px' }}>
                  <h4 style={{ marginBottom: '12px' }}>Selective Delete</h4>
                  <p className="subsection-description">
                    Select individual conversations to delete.
                  </p>

                  {isLoadingChatList ? (
                    <div className="chat-list-empty">Loading conversations...</div>
                  ) : chatList.length === 0 ? (
                    <div className="chat-list-empty">No conversations found.</div>
                  ) : (
                    <>
                      <div className="chat-list-header">
                        <label className="select-all-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedChats.size === chatList.length && chatList.length > 0}
                            onChange={toggleSelectAll}
                          />
                          <span>Select All ({chatList.length})</span>
                        </label>
                        <button
                          className="delete-selected-btn"
                          onClick={() => setShowDeleteSelectedConfirm(true)}
                          disabled={selectedChats.size === 0}
                        >
                          Delete Selected ({selectedChats.size})
                        </button>
                      </div>

                      <div className="chat-list">
                        {chatList.map(chat => (
                          <div key={chat.id} className="chat-list-item">
                            <input
                              type="checkbox"
                              checked={selectedChats.has(chat.id)}
                              onChange={() => toggleChatSelection(chat.id)}
                            />
                            <div className="chat-list-item-content">
                              <div className="chat-list-item-title">{chat.title || 'Untitled'}</div>
                              <div className="chat-list-item-meta">
                                {chat.message_count} message{chat.message_count !== 1 ? 's' : ''} • {new Date(chat.created_at).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Delete All - Danger Zone */}
                <div className="subsection" style={{ marginTop: '32px', paddingTop: '20px', borderTop: '1px solid #e0e0e0' }}>
                  <h4 style={{ color: '#f87171' }}>Danger Zone</h4>
                  <p className="subsection-description">
                    Permanently delete all conversation history. This action cannot be undone.
                  </p>
                  <button
                    className="reset-button"
                    onClick={() => setShowDeleteAllConfirm(true)}
                    disabled={isLoadingChatList || chatList.length === 0}
                  >
                    Delete All History ({chatList.length} conversation{chatList.length !== 1 ? 's' : ''})
                  </button>
                </div>
              </section>
            )}

            {/* DICTATION */}
            {activeSection === 'dictation' && (
              <DictationSettings
                dictationLanguage={parentDictationLanguage || dictationLanguage}
                setDictationLanguage={(lang) => {
                  setDictationLanguage(lang);
                  if (setParentDictationLanguage) {
                    setParentDictationLanguage(lang);
                  }
                }}
              />
            )}

            {/* CREDITS */}
            {activeSection === 'credits' && (
              <section className="settings-section">
                <h3>Credits</h3>
                <p className="section-description">
                  This project was inspired by and builds upon the work of the following developers:
                </p>

                <div className="credits-list">
                  <a
                    href="https://github.com/karpathy/llm-council"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="credit-item"
                  >
                    <span className="credit-icon">🏛️</span>
                    <div className="credit-info">
                      <span className="credit-title">karpathy/llm-council</span>
                      <span className="credit-desc">Original LLM Council concept by Andrej Karpathy</span>
                    </div>
                  </a>
                  <a
                    href="https://github.com/jacob-bd/llm-council-plus"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="credit-item"
                  >
                    <span className="credit-icon">🚀</span>
                    <div className="credit-info">
                      <span className="credit-title">jacob-bd/llm-council-plus</span>
                      <span className="credit-desc">Extended fork with additional features</span>
                    </div>
                  </a>
                  <a
                    href="https://www.youtube.com/watch?v=AmduXg_xFEM"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="credit-item"
                  >
                    <span className="credit-icon">💻</span>
                    <div className="credit-info">
                      <span className="credit-title">Sean Kochel</span>
                      <span className="credit-desc">Self-correcting agent architecture inspiration</span>
                    </div>
                  </a>
                  <a
                    href="https://www.youtube.com/watch?v=LpM1dlB12-A"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="credit-item"
                  >
                    <span className="credit-icon">🔥</span>
                    <div className="credit-info">
                      <span className="credit-title">Mark Kashef</span>
                      <span className="credit-desc">Council member debate inspiration</span>
                    </div>
                  </a>
                </div>
              </section>
            )}

          </div>
        </div>

        <div className="settings-footer">
          {error && <div className="settings-error">{error}</div>}
          {success && (
            <div className="settings-success">
              {successMessage || (activeSection === 'llm_keys' && !settings?.openrouter_api_key_set && !ollamaStatus?.connected
                ? 'Defaults loaded. Please configure an API Key.'
                : 'Settings saved!')}
            </div>
          )}

          <div className="footer-actions">
            <button className="cancel-button" onClick={onClose}>
              Close
            </button>
            <button
              className="save-button"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? 'Saving...' : (success ? 'Saved!' : 'Save Changes')}
            </button>
            <button
              className="refresh-council-button"
              onClick={handleRefreshCouncil}
              disabled={isSaving}
              title="Refresh Council"
            >
              <span className="refresh-icon">&#8634;</span>
            </button>
          </div>
        </div>
      </div>

      {
        showResetConfirm && (
          <div className="settings-overlay confirmation-overlay" onClick={() => setShowResetConfirm(false)}>
            <div className="settings-modal confirmation-modal" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h2>Confirm Reset</h2>
              </div>
              <div className="settings-content confirmation-content" style={{ padding: '20px 24px' }}>
                <p style={{ marginBottom: '16px' }}>Are you sure you want to reset to defaults?</p>
                <div className="confirmation-details" style={{ padding: '16px 20px' }}>
                  <p><strong>This will reset:</strong></p>
                  <ul style={{ margin: '12px 0', lineHeight: '1.8' }}>
                    <li>Provider toggles → All disabled</li>
                    <li>Model selections → Cleared</li>
                    <li>Council size → Reset to 2 members</li>
                    <li>Temperatures → Defaults (0.5 / 0.4 / 0.3 / 0.5)</li>
                    <li>System prompts → Defaults</li>
                    <li>Search provider → DuckDuckGo</li>
                    <li>Jina fetch count → 3</li>
                    <li>Ollama URL → localhost:11434</li>
                  </ul>
                  <p className="confirmation-safe" style={{ marginTop: '14px' }}>+ API keys will be PRESERVED</p>
                </div>
              </div>
              <div className="settings-footer">
                <div className="footer-actions" style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <button className="cancel-button" onClick={() => setShowResetConfirm(false)}>Cancel</button>
                  <button className="reset-button" onClick={confirmResetToDefaults}>Confirm Reset</button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {
        showDeleteAllConfirm && (
          <div className="settings-overlay confirmation-overlay" onClick={() => setShowDeleteAllConfirm(false)}>
            <div className="settings-modal confirmation-modal" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h2>Delete All Conversations</h2>
              </div>
              <div className="settings-content confirmation-content" style={{ padding: '20px 24px' }}>
                <p style={{ marginBottom: '16px' }}>Are you sure you want to delete ALL conversations?</p>
                <div className="confirmation-details" style={{ padding: '16px 20px' }}>
                  <p><strong>This will permanently delete:</strong></p>
                  <ul style={{ margin: '12px 0', lineHeight: '1.8' }}>
                    <li>All conversation history ({chatList.length} conversation{chatList.length !== 1 ? 's' : ''})</li>
                    <li>All message content and metadata</li>
                    <li>Council config snapshots</li>
                  </ul>
                  <p style={{ color: '#f87171', fontWeight: 600, marginTop: '14px' }}>This action CANNOT be undone.</p>
                </div>
              </div>
              <div className="settings-footer">
                <div className="footer-actions" style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <button className="cancel-button" onClick={() => setShowDeleteAllConfirm(false)}>Cancel</button>
                  <button className="reset-button" onClick={handleDeleteAll}>Delete All</button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {
        showDeleteSelectedConfirm && (
          <div className="settings-overlay confirmation-overlay" onClick={() => setShowDeleteSelectedConfirm(false)}>
            <div className="settings-modal confirmation-modal" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h2>Delete Selected Conversations</h2>
              </div>
              <div className="settings-content confirmation-content" style={{ padding: '20px 24px' }}>
                <p style={{ marginBottom: '16px' }}>Delete {selectedChats.size} selected conversation{selectedChats.size !== 1 ? 's' : ''}?</p>
                <div className="confirmation-details" style={{ padding: '16px 20px' }}>
                  <p><strong>This will permanently delete:</strong></p>
                  <ul style={{ margin: '12px 0', lineHeight: '1.8' }}>
                    <li>{selectedChats.size} conversation{selectedChats.size !== 1 ? 's' : ''}</li>
                    <li>All message content within them</li>
                  </ul>
                  <p style={{ color: '#f87171', fontWeight: 600, marginTop: '14px' }}>This action CANNOT be undone.</p>
                </div>
              </div>
              <div className="settings-footer">
                <div className="footer-actions" style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <button className="cancel-button" onClick={() => setShowDeleteSelectedConfirm(false)}>Cancel</button>
                  <button className="reset-button" onClick={handleDeleteSelected}>Delete Selected</button>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}