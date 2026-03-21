import React, { useState } from 'react';
import SearchableModelSelect from '../SearchableModelSelect';
import { api } from '../../api';

const DIRECT_PROVIDERS = [
    { id: 'openai', name: 'OpenAI', key: 'openai_api_key' },
    { id: 'anthropic', name: 'Anthropic', key: 'anthropic_api_key' },
    { id: 'google', name: 'Google', key: 'google_api_key' },
    { id: 'perplexity', name: 'Perplexity', key: 'perplexity_api_key' },
    { id: 'mistral', name: 'Mistral', key: 'mistral_api_key' },
    { id: 'deepseek', name: 'DeepSeek', key: 'deepseek_api_key' },
    { id: 'glm', name: 'GLM', key: 'glm_api_key' },
    { id: 'kimi', name: 'Kimi', key: 'kimi_api_key' },
];

export default function CouncilConfig({
    settings,
    // API key status for toggle disable logic
    apiKeysConfigured,
    ollamaConnected,
    // State
    enabledProviders,
    setEnabledProviders,
    directProviderToggles,
    setDirectProviderToggles,
    showFreeOnly,
    setShowFreeOnly,
    isLoadingModels,
    rateLimitWarning,
    councilModels,
    councilMemberFilters,
    chairmanModel,
    setChairmanModel,
    chairmanFilter,
    setChairmanFilter,
    councilTemperature,
    setCouncilTemperature,
    chairmanTemperature,
    setChairmanTemperature,
    characterNames,
    setCharacterNames,
    memberPrompts,
    setMemberPrompts,
    // Chairman identity
    chairmanCharacterName,
    setChairmanCharacterName,
    chairmanCustomPrompt,
    setChairmanCustomPrompt,
    // Additional config for presets
    stage2Temperature,
    executionMode,
    webSearchEnabled,
    searchProvider,
    // Preset callback
    onPresetsChange,
    // Data
    allModels, // Result of getAllAvailableModels()
    filteredModels, // Result of getFilteredAvailableModels()
    ollamaAvailableModels,
    customEndpointName,
    customEndpointUrl,
    // Callbacks
    handleFeelingLucky,
    handleMemberFilterChange,
    handleCouncilModelChange,
    handleRemoveCouncilMember,
    handleAddCouncilMember,
    setActiveSection,
    setActivePromptTab,
    isFrozen,
    onNewDiscussion
}) {
    // Preset save state
    const [presetName, setPresetName] = useState('');
    const [isSavingPreset, setIsSavingPreset] = useState(false);
    const [presetSaveResult, setPresetSaveResult] = useState(null);

    // Helper to check if provider has required credentials/connection
    const canEnableProvider = (provider) => {
        const apiKeys = apiKeysConfigured || {};
        switch (provider) {
            case 'openrouter':
                return apiKeys.openrouter;
            case 'groq':
                return apiKeys.groq;
            case 'ollama':
                return ollamaConnected || false;
            case 'custom':
                return true; // Custom endpoint key is optional
            case 'openai':
                return apiKeys.openai;
            case 'anthropic':
                return apiKeys.anthropic;
            case 'google':
                return apiKeys.google;
            case 'perplexity':
                return apiKeys.perplexity;
            case 'mistral':
                return apiKeys.mistral;
            case 'deepseek':
                return apiKeys.deepseek;
            case 'glm':
                return apiKeys.glm;
            case 'kimi':
                return apiKeys.kimi;
            default:
                return true;
        }
    };

    // Helper to check if any direct provider has credentials
    const hasAnyDirectKey = () => {
        const apiKeys = apiKeysConfigured || {};
        return (
            apiKeys.openai ||
            apiKeys.anthropic ||
            apiKeys.google ||
            apiKeys.perplexity ||
            apiKeys.mistral ||
            apiKeys.deepseek ||
            apiKeys.glm ||
            apiKeys.kimi
        );
    };

    // Helper: Filter models by remote/local for specific use case
    const filterByRemoteLocal = (models, filter) => {
        if (filter === 'local') {
            // Only Ollama models
            return models.filter(m => m.id.startsWith('ollama:'));
        } else {
            // Remote: OpenRouter + Direct providers (exclude Ollama)
            return models.filter(m => !m.id.startsWith('ollama:'));
        }
    };

    const getMemberFilter = (index) => {
        return councilMemberFilters[index] || 'remote';
    };

    // Handle saving current config as a preset
    const handleSavePreset = async () => {
        if (!presetName.trim()) {
            setPresetSaveResult({ success: false, message: 'Please enter a preset name' });
            return;
        }

        setIsSavingPreset(true);
        setPresetSaveResult(null);

        const config = {
            council_models: councilModels,
            chairman_model: chairmanModel,
            council_temperature: councilTemperature,
            chairman_temperature: chairmanTemperature,
            stage2_temperature: stage2Temperature,
            character_names: characterNames,
            member_prompts: memberPrompts,
            chairman_character_name: chairmanCharacterName,
            chairman_custom_prompt: chairmanCustomPrompt,
            execution_mode: executionMode || 'full',
            web_search_enabled: webSearchEnabled ?? true,
            search_provider: searchProvider || 'duckduckgo',
            enabled_providers: enabledProviders,
            direct_provider_toggles: directProviderToggles,
        };

        try {
            await api.createPreset(presetName.trim(), config);
            setPresetSaveResult({ success: true, message: `Preset "${presetName.trim()}" saved!` });
            setPresetName('');
            // Notify parent to refresh presets dropdown
            if (onPresetsChange) onPresetsChange();
        } catch (err) {
            if (err.message?.includes('already exists')) {
                setPresetSaveResult({ success: false, message: 'A preset with this name already exists' });
            } else {
                setPresetSaveResult({ success: false, message: 'Failed to save preset' });
            }
        } finally {
            setIsSavingPreset(false);
            // Auto-clear result after 3 seconds
            setTimeout(() => setPresetSaveResult(null), 3000);
        }
    };

    return (
        <>
            {isFrozen && (
                <div className="frozen-banner">
                    <span className="frozen-banner-icon">🔒</span>
                    <span className="frozen-banner-text">
                        Settings are locked for this conversation. Start a{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); onNewDiscussion(); }}>
                            new discussion
                        </a>{' '}
                        to change config.
                    </span>
                </div>
            )}
            <section className={`settings-section frozen-section${isFrozen ? ' frozen' : ''}`}>
                <h3>Available Model Sources</h3>
                <p className="section-description">
                    Toggle which providers are available for the search generator, council members, and chairman.
                    <br /><em style={{ opacity: 0.7, fontSize: '12px' }}>Note: Non-chat models (embeddings, image generation, speech, OCR, etc.) are automatically filtered out.</em>
                </p>

                <div className="hybrid-settings-card">
                    {/* Primary Sources */}
                    <div className="filter-group">
                        <label className={`toggle-wrapper ${!canEnableProvider('openrouter') ? 'toggle-disabled' : ''}`}
                            data-tooltip={!canEnableProvider('openrouter') ? 'API key required - configure in LLM API Keys section' : ''}>
                            <div className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={enabledProviders.openrouter}
                                    onChange={(e) => setEnabledProviders(prev => ({ ...prev, openrouter: e.target.checked }))}
                                    disabled={!canEnableProvider('openrouter')}
                                />
                                <span className="slider"></span>
                            </div>
                            <span className="toggle-text">OpenRouter (Cloud)</span>
                        </label>

                        <label className={`toggle-wrapper ${!canEnableProvider('ollama') ? 'toggle-disabled' : ''}`}
                            data-tooltip={!canEnableProvider('ollama') ? 'Ollama not connected - ensure Ollama is running locally' : ''}>
                            <div className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={enabledProviders.ollama}
                                    onChange={(e) => setEnabledProviders(prev => ({ ...prev, ollama: e.target.checked }))}
                                    disabled={!canEnableProvider('ollama')}
                                />
                                <span className="slider"></span>
                            </div>
                            <span className="toggle-text">Local (Ollama)</span>
                        </label>

                        <label className={`toggle-wrapper ${!canEnableProvider('groq') ? 'toggle-disabled' : ''}`}
                            data-tooltip={!canEnableProvider('groq') ? 'API key required - configure in LLM API Keys section' : ''}>
                            <div className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={enabledProviders.groq}
                                    onChange={(e) => setEnabledProviders(prev => ({ ...prev, groq: e.target.checked }))}
                                    disabled={!canEnableProvider('groq')}
                                />
                                <span className="slider"></span>
                            </div>
                            <span className="toggle-text">Groq (Fast Inference)</span>
                        </label>

                        {/* Custom Endpoint Toggle - only show if configured */}
                        {(settings?.custom_endpoint_url || customEndpointUrl) && (
                            <label className="toggle-wrapper">
                                <div className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        checked={enabledProviders.custom}
                                        onChange={(e) => setEnabledProviders(prev => ({ ...prev, custom: e.target.checked }))}
                                    />
                                    <span className="slider"></span>
                                </div>
                                <span className="toggle-text">{settings?.custom_endpoint_name || customEndpointName || 'Custom Endpoint'}</span>
                            </label>
                        )}
                    </div>

                    <div className="filter-divider"></div>

                    {/* Direct Connections Master Toggle */}
                    <div className="filter-group" style={{ marginBottom: '12px' }}>
                        <label className={`toggle-wrapper ${!hasAnyDirectKey() ? 'toggle-disabled' : ''}`}
                            title={!hasAnyDirectKey() ? 'At least one direct provider API key required' : ''}>
                            <div className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={enabledProviders.direct}
                                    onChange={(e) => {
                                        const isEnabled = e.target.checked;
                                        setEnabledProviders(prev => ({ ...prev, direct: isEnabled }));
                                        // If master turned off, disable all children
                                        if (!isEnabled) {
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
                                        }
                                    }}
                                    disabled={!hasAnyDirectKey()}
                                />
                                <span className="slider"></span>
                            </div>
                            <span className="toggle-text">Direct Connections</span>
                        </label>
                    </div>

                    {/* Individual Direct Provider Toggles (purple) */}
                    <div className="direct-grid" style={{ opacity: enabledProviders.direct ? 1 : 0.7 }}>
                        {DIRECT_PROVIDERS.map(dp => (
                            <label
                                key={dp.id}
                                className={`toggle-wrapper ${!canEnableProvider(dp.id) ? 'toggle-disabled' : ''}`}
                                data-tooltip={!canEnableProvider(dp.id) ? 'API key required' : ''}
                            >
                                <div className="toggle-switch direct-toggle">
                                    <input
                                        type="checkbox"
                                        checked={directProviderToggles[dp.id]}
                                        onChange={(e) => {
                                            const isEnabled = e.target.checked;
                                            setDirectProviderToggles(prev => {
                                                const newState = { ...prev, [dp.id]: isEnabled };

                                                // Auto-enable master if any child is enabled
                                                if (isEnabled && !enabledProviders.direct) {
                                                    setEnabledProviders(prevEP => ({ ...prevEP, direct: true }));
                                                }

                                                // Auto-disable master if ALL children are disabled
                                                const hasAnyEnabled = Object.values(newState).some(v => v);
                                                if (!hasAnyEnabled && enabledProviders.direct) {
                                                    setEnabledProviders(prevEP => ({ ...prevEP, direct: false }));
                                                }

                                                return newState;
                                            });
                                        }}
                                        disabled={!canEnableProvider(dp.id)}
                                    />
                                    <span className="slider"></span>
                                </div>
                                <span className="toggle-text" style={{ fontSize: '13px' }}>
                                    {dp.name}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>
            </section>

            <section className={`settings-section frozen-section${isFrozen ? ' frozen' : ''}`}>
                <h3>Council Composition</h3>
                <div className="model-options-row">
                    <div className="model-filter-controls">
                        <label className="free-filter-label" style={{ opacity: enabledProviders.openrouter ? 1 : 0.3, cursor: enabledProviders.openrouter ? 'pointer' : 'not-allowed' }}>
                            <input
                                type="checkbox"
                                checked={showFreeOnly}
                                onChange={e => setShowFreeOnly(e.target.checked)}
                                disabled={!enabledProviders.openrouter}
                            />
                            Show free OpenRouter models only
                            <div className="info-tooltip-container">
                                <span className="info-icon">i</span>
                                <div className="info-tooltip">
                                    Free OpenRouter models are limited to 20 requests/minute and 50/day (without credits). Large councils generate many requests at once.
                                </div>
                            </div>
                        </label>
                        {isLoadingModels && <span className="loading-models">Loading models...</span>}
                    </div>
                </div>
                <div className="lucky-button-container">
                    <button
                        type="button"
                        className="lucky-button"
                        onClick={handleFeelingLucky}
                        title="Randomize models from enabled sources"
                    >
                        🎲 I'm Feeling Lucky
                    </button>
                </div>
                {/* Council Members */}
                <div className="subsection council-subsection">
                    <div className="council-members-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0 }}>Council Members</h4>
                    </div>
                    <div className="council-members">
                        {councilModels.map((modelId, index) => {
                            const memberFilter = getMemberFilter(index);
                            return (
                                <div key={index} className="council-member-row">
                                    <div className="council-member-controls">
                                        <span className="member-label">Member {index + 1}</span>
                                        <div className="model-type-toggle">
                                            <button
                                                type="button"
                                                className={`type-btn ${memberFilter === 'remote' ? 'active' : ''}`}
                                                onClick={() => handleMemberFilterChange(index, 'remote')}
                                                disabled={!enabledProviders.openrouter && !enabledProviders.direct && !enabledProviders.groq && !enabledProviders.custom}
                                                title={!enabledProviders.openrouter && !enabledProviders.direct && !enabledProviders.groq && !enabledProviders.custom ? 'Enable a remote provider first' : ''}
                                            >
                                                Remote
                                            </button>
                                            <button
                                                type="button"
                                                className={`type-btn ${memberFilter === 'local' ? 'active' : ''}`}
                                                onClick={() => handleMemberFilterChange(index, 'local')}
                                                disabled={!enabledProviders.ollama || ollamaAvailableModels.length === 0}
                                                title={!enabledProviders.ollama || ollamaAvailableModels.length === 0 ? 'Enable and connect Ollama first' : ''}
                                            >
                                                Local
                                            </button>
                                        </div>
                                        <div className="model-select-wrapper">
                                            <SearchableModelSelect
                                                models={filterByRemoteLocal(filteredModels, memberFilter)}
                                                value={modelId}
                                                onChange={(value) => handleCouncilModelChange(index, value)}
                                                placeholder={isLoadingModels && allModels.length === 0 ? "Loading models..." : "Search models..."}
                                                isDisabled={isLoadingModels && allModels.length === 0}
                                                isLoading={isLoadingModels}
                                                allModels={allModels}
                                            />
                                        </div>
                                        {index >= 2 && (
                                            <button
                                                type="button"
                                                className="remove-member-button"
                                                onClick={() => handleRemoveCouncilMember(index)}
                                                title="Remove member"
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                    <div className="member-identity-fields">
                                        <input
                                            type="text"
                                            className="character-name-input"
                                            placeholder="Character name (optional)"
                                            value={characterNames[index] || ''}
                                            onChange={(e) => setCharacterNames(prev => ({
                                                ...prev,
                                                [index]: e.target.value
                                            }))}
                                            maxLength={30}
                                        />
                                        <div className="member-prompt-container">
                                            <textarea
                                                className="member-prompt-input"
                                                placeholder="Custom prompt for this member (optional, prepended to stage prompts)"
                                                value={memberPrompts[index] || ''}
                                                onChange={(e) => setMemberPrompts(prev => ({
                                                    ...prev,
                                                    [index]: e.target.value
                                                }))}
                                                rows={2}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        className="add-member-button"
                        onClick={handleAddCouncilMember}
                        disabled={filteredModels.length === 0 || councilModels.length >= 8}
                    >
                        + Add Council Member
                    </button>
                    <p className="section-description" style={{ marginTop: '8px', marginBottom: '0' }}>
                        Max 8 members. With 6+ members, requests are processed in batches.
                    </p>
                    {councilModels.length >= 6 && (
                        <div className="council-size-warning">
                            ⚠️ <strong>6+ members:</strong> Requests will be processed in batches of 3 to avoid rate limits.
                        </div>
                    )}

                    {/* Rate Limit Warning Banner */}
                    {rateLimitWarning && (
                        <div className={`rate-limit-warning ${rateLimitWarning.type}`}>
                            <span className="warning-icon">
                                {rateLimitWarning.type === 'error' ? '🛑' : '⚠️'}
                            </span>
                            <div>
                                <strong>{rateLimitWarning.title}</strong><br />
                                {rateLimitWarning.message}
                            </div>
                        </div>
                    )}

                    {/* Council Heat Slider */}
                    <div className="subsection chairman-subsection">
                        <div className="heat-slider-header">
                            <h4>Council Heat</h4>
                            <span className="heat-value">{councilTemperature.toFixed(1)}</span>
                        </div>
                        <div className="heat-slider-container">
                            <span className="heat-icon cold">❄️</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={councilTemperature}
                                onChange={(e) => setCouncilTemperature(parseFloat(e.target.value))}
                                className="heat-slider"
                                disabled={councilModels.every(m => m.includes('gpt-5.1') || m.includes('o1-') || m.includes('o3-'))}
                            />
                            <span className="heat-icon hot">🔥</span>
                        </div>
                        {councilModels.some(m => m.includes('gpt-5.1') || m.includes('o1-') || m.includes('o3-')) && (
                            <div className="heat-warning">
                                ⚠️ Some selected models (e.g. GPT-5.1, o1) enforce fixed temperature and will ignore this setting.
                            </div>
                        )}
                        <p className="heat-note" style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                            ℹ️ Stage 2 (Peer Ranking) has its own temperature setting.{' '}
                            <button
                                type="button"
                                onClick={() => { setActiveSection('prompts'); setActivePromptTab('stage2'); }}
                                style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '11px' }}
                            >
                                Configure in System Prompts → Stage 2
                            </button>
                        </p>
                    </div>
                </div>
                {/* Chairman */}
                <div className="subsection chairman-model-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h4 style={{ margin: 0 }}>Chairman Model</h4>
                        <div className="model-type-toggle">
                            <button
                                type="button"
                                className={`type-btn ${chairmanFilter === 'remote' ? 'active' : ''}`}
                                onClick={() => {
                                    setChairmanFilter('remote');
                                    setChairmanModel('');
                                }}
                                disabled={!enabledProviders.openrouter && !enabledProviders.direct && !enabledProviders.groq && !enabledProviders.custom}
                                title={!enabledProviders.openrouter && !enabledProviders.direct && !enabledProviders.groq && !enabledProviders.custom ? 'Enable a remote provider first' : ''}
                            >
                                Remote
                            </button>
                            <button
                                type="button"
                                className={`type-btn ${chairmanFilter === 'local' ? 'active' : ''}`}
                                onClick={() => {
                                    setChairmanFilter('local');
                                    setChairmanModel('');
                                }}
                                disabled={!enabledProviders.ollama || ollamaAvailableModels.length === 0}
                                title={!enabledProviders.ollama || ollamaAvailableModels.length === 0 ? 'Enable and connect Ollama first' : ''}
                            >
                                Local
                            </button>
                        </div>
                    </div>
                    <div className="chairman-selection">
                        <SearchableModelSelect
                            models={filterByRemoteLocal(filteredModels, chairmanFilter)}
                            value={chairmanModel}
                            onChange={(value) => setChairmanModel(value)}
                            placeholder="Search models..."
                            isLoading={isLoadingModels}
                            allModels={allModels}
                        />
                    </div>

                    {/* Chairman Identity Fields */}
                    <div className="chairman-identity-fields" style={{ marginTop: '16px' }}>
                        <input
                            type="text"
                            className="character-name-input"
                            placeholder="Chairman character name (optional)"
                            value={chairmanCharacterName || ''}
                            onChange={(e) => setChairmanCharacterName(e.target.value)}
                            maxLength={30}
                        />
                        <div className="member-prompt-container" style={{ marginTop: '8px' }}>
                            <textarea
                                className="member-prompt-input"
                                placeholder="Custom prompt for chairman (optional, prepended to Stage 5 synthesis prompt)"
                                value={chairmanCustomPrompt || ''}
                                onChange={(e) => setChairmanCustomPrompt(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>

                    {/* Chairman Heat Slider */}
                    <div className="subsection chairman-subsection">
                        <div className="heat-slider-header">
                            <h4>Chairman Heat</h4>
                            <span className="heat-value">{chairmanTemperature.toFixed(1)}</span>
                        </div>
                        <div className="heat-slider-container">
                            <span className="heat-icon cold">❄️</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={chairmanTemperature}
                                onChange={(e) => setChairmanTemperature(parseFloat(e.target.value))}
                                className="heat-slider"
                                disabled={chairmanModel.includes('gpt-5.1') || chairmanModel.includes('o1-') || chairmanModel.includes('o3-')}
                            />
                            <span className="heat-icon hot">🔥</span>
                        </div>
                        {(chairmanModel.includes('gpt-5.1') || chairmanModel.includes('o1-') || chairmanModel.includes('o3-')) && (
                            <div className="heat-warning">
                                ⚠️ This model enforces fixed temperature and will ignore this setting.
                            </div>
                        )}
                    </div>
                </div>

            </section>

            {/* Save Current Config Section */}
            <section className={`settings-section frozen-section${isFrozen ? ' frozen' : ''}`}>
                <h3>Save Current Config</h3>
                <div className="preset-create-form">
                    <input
                        type="text"
                        className="preset-name-input"
                        placeholder="Preset name..."
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        disabled={isSavingPreset}
                    />
                    <button
                        type="button"
                        className="save-preset-btn"
                        onClick={handleSavePreset}
                        disabled={isSavingPreset || !presetName.trim()}
                    >
                        {isSavingPreset ? 'Saving...' : 'Save Preset'}
                    </button>
                </div>
                {/* Feedback message */}
                {presetSaveResult && (
                    <div className={`preset-save-result ${presetSaveResult.success ? 'success' : 'error'}`}>
                        {presetSaveResult.message}
                    </div>
                )}
            </section>
        </>
    );
}
