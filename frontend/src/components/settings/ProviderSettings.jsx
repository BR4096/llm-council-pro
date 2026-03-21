import React from 'react';
import openrouterIcon from '../../assets/icons/openrouter.svg';
import groqIcon from '../../assets/icons/groq.svg';
import ollamaIcon from '../../assets/icons/ollama.svg';
import openaiIcon from '../../assets/icons/openai.svg';
import anthropicIcon from '../../assets/icons/anthropic.svg';
import googleIcon from '../../assets/icons/google.svg';
import perplexityIcon from '../../assets/icons/perplexity.svg';
import mistralIcon from '../../assets/icons/mistral.svg';
import deepseekIcon from '../../assets/icons/deepseek.svg';
import glmIcon from '../../assets/icons/glm.svg';
import kimiIcon from '../../assets/icons/kimi.svg';
import customEndpointIcon from '../../assets/icons/openai-compatible.svg';

const PROVIDER_ICONS = {
    openai: openaiIcon,
    anthropic: anthropicIcon,
    google: googleIcon,
    perplexity: perplexityIcon,
    mistral: mistralIcon,
    deepseek: deepseekIcon,
    glm: glmIcon,
    kimi: kimiIcon,
};

const DIRECT_PROVIDERS = [
    { id: 'openai', name: 'OpenAI', key: 'openai_api_key' },
    { id: 'anthropic', name: 'Anthropic', key: 'anthropic_api_key' },
    { id: 'google', name: 'Google', key: 'google_api_key' },
    { id: 'perplexity', name: 'Perplexity', key: 'perplexity_api_key' },
    { id: 'mistral', name: 'Mistral', key: 'mistral_api_key' },
    { id: 'deepseek', name: 'DeepSeek', key: 'deepseek_api_key' },
    { id: 'glm', name: 'GLM Coding Plan', key: 'glm_api_key' },
    { id: 'kimi', name: 'Kimi Code', key: 'kimi_api_key' },
];

export default function ProviderSettings({
    settings,
    // OpenRouter
    openrouterApiKey,
    setOpenrouterApiKey,
    handleTestOpenRouter,
    isTestingOpenRouter,
    openrouterTestResult,
    handleClearOpenRouterKey,
    // Groq
    groqApiKey,
    setGroqApiKey,
    handleTestGroq,
    isTestingGroq,
    groqTestResult,
    handleClearGroqKey,
    // Ollama
    ollamaBaseUrl,
    setOllamaBaseUrl,
    handleTestOllama,
    isTestingOllama,
    ollamaTestResult,
    ollamaStatus,
    loadOllamaModels,
    handleClearOllamaUrl,
    // Direct
    directKeys,
    setDirectKeys,
    handleTestDirectKey,
    validatingKeys,
    keyValidationStatus,
    handleClearDirectKey,
    // Custom Endpoint
    customEndpointName,
    setCustomEndpointName,
    customEndpointUrl,
    setCustomEndpointUrl,
    customEndpointApiKey,
    setCustomEndpointApiKey,
    handleTestCustomEndpoint,
    isTestingCustomEndpoint,
    customEndpointTestResult,
    customEndpointModels,
    handleClearCustomEndpoint
}) {
    return (
        <section className="settings-section">
            <h3>LLM API Keys</h3>
            <p className="section-description">
                Configure keys for LLM providers.
                Keys are <strong>auto-saved</strong> immediately upon successful test.
            </p>

            {/* OpenRouter */}
            <form className="api-key-section" onSubmit={e => e.preventDefault()}>
                <label>
                    <img src={openrouterIcon} alt="" className="provider-icon" />
                    OpenRouter API Key
                </label>
                <div className="api-key-input-row">
                    <input
                        type="password"
                        placeholder={settings?.openrouter_api_key_set ? '••••••••••••••••' : 'Enter API key'}
                        value={openrouterApiKey}
                        onChange={(e) => setOpenrouterApiKey(e.target.value)}
                        className={settings?.openrouter_api_key_set && !openrouterApiKey ? 'key-configured' : ''}
                    />
                    {settings?.openrouter_api_key_set && !openrouterApiKey && (
                        <button
                            type="button"
                            className="clear-icon-btn"
                            onClick={handleClearOpenRouterKey}
                            title="Clear API key"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    )}
                    <button
                        className="retest-icon-btn"
                        onClick={handleTestOpenRouter}
                        disabled={!openrouterApiKey || isTestingOpenRouter}
                        title={settings?.openrouter_api_key_set ? "Retest API key" : "Test API key"}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                </div>
                {settings?.openrouter_api_key_set && !openrouterApiKey && (
                    <div className="key-status set">✓ API key configured</div>
                )}
                {openrouterTestResult && (
                    <div className={`test-result ${openrouterTestResult.success ? 'success' : 'error'}`}>
                        {openrouterTestResult.message}
                    </div>
                )}
                <p className="api-key-hint">
                    Get key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai</a>
                </p>
            </form>

            {/* Groq */}
            <form className="api-key-section" onSubmit={e => e.preventDefault()}>
                <label>
                    <img src={groqIcon} alt="" className="provider-icon" />
                    Groq API Key
                </label>
                <div className="api-key-input-row">
                    <input
                        type="password"
                        placeholder={settings?.groq_api_key_set ? '••••••••••••••••' : 'Enter API key'}
                        value={groqApiKey}
                        onChange={(e) => setGroqApiKey(e.target.value)}
                        className={settings?.groq_api_key_set && !groqApiKey ? 'key-configured' : ''}
                    />
                    {settings?.groq_api_key_set && !groqApiKey && (
                        <button
                            type="button"
                            className="clear-icon-btn"
                            onClick={handleClearGroqKey}
                            title="Clear API key"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    )}
                    <button
                        className="retest-icon-btn"
                        onClick={handleTestGroq}
                        disabled={!groqApiKey || isTestingGroq}
                        title={settings?.groq_api_key_set ? "Retest API key" : "Test API key"}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                </div>
                {settings?.groq_api_key_set && !groqApiKey && (
                    <div className="key-status set">✓ API key configured</div>
                )}
                {groqTestResult && (
                    <div className={`test-result ${groqTestResult.success ? 'success' : 'error'}`}>
                        {groqTestResult.message}
                    </div>
                )}
                <p className="api-key-hint">
                    Get key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com</a>
                </p>
            </form>

            {/* Ollama */}
            <form className="api-key-section" onSubmit={e => e.preventDefault()}>
                <label>
                    <img src={ollamaIcon} alt="" className="provider-icon" />
                    Ollama Base URL
                </label>
                <div className="api-key-input-row">
                    <input
                        type="text"
                        placeholder="http://localhost:11434"
                        value={ollamaBaseUrl}
                        onChange={(e) => setOllamaBaseUrl(e.target.value)}
                    />
                    {ollamaBaseUrl !== 'http://localhost:11434' && (
                        <button
                            type="button"
                            className="clear-icon-btn"
                            onClick={handleClearOllamaUrl}
                            title="Reset to default"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <path d="M3 3v5h5"></path>
                            </svg>
                        </button>
                    )}
                    <button
                        className="retest-icon-btn"
                        onClick={handleTestOllama}
                        disabled={!ollamaBaseUrl || isTestingOllama}
                        title="Connect"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                </div>
                {ollamaTestResult && (
                    <div className={`test-result ${ollamaTestResult.success ? 'success' : 'error'}`}>
                        {ollamaTestResult.message}
                    </div>
                )}
                {ollamaStatus && ollamaStatus.connected && (
                    <div className="key-status set">✓ Connected</div>
                )}
                {ollamaStatus && !ollamaStatus.connected && !ollamaStatus.testing && (
                    <div className="key-status">● Not connected</div>
                )}
                <div className="model-options-row" style={{ marginTop: '12px' }}>
                    <button
                        type="button"
                        className="refresh-local-models-button"
                        onClick={() => loadOllamaModels(ollamaBaseUrl)}
                    >
                        Refresh Local Models
                    </button>
                </div>
            </form>

            {/* Direct LLM API Connections */}
            <div className="subsection" style={{ marginTop: '24px' }}>
                <h4>Direct LLM Connections</h4>
                {DIRECT_PROVIDERS.map(dp => (
                    <form key={dp.id} className="api-key-section" onSubmit={e => e.preventDefault()}>
                        <label>
                            <img src={PROVIDER_ICONS[dp.id]} alt="" className="provider-icon" />
                            {dp.name} API Key
                        </label>
                        <div className="api-key-input-row">
                            <input
                                type="password"
                                placeholder={settings?.[`${dp.key}_set`] ? '••••••••••••••••' : 'Enter API key'}
                                value={directKeys[dp.key]}
                                onChange={e => setDirectKeys(prev => ({ ...prev, [dp.key]: e.target.value }))}
                                className={settings?.[`${dp.key}_set`] && !directKeys[dp.key] ? 'key-configured' : ''}
                            />
                            {settings?.[`${dp.key}_set`] && !directKeys[dp.key] && (
                                <button
                                    type="button"
                                    className="clear-icon-btn"
                                    onClick={() => handleClearDirectKey(dp.key)}
                                    title="Clear API key"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            )}
                            <button
                                className="retest-icon-btn"
                                onClick={() => handleTestDirectKey(dp.id, dp.key)}
                                disabled={!directKeys[dp.key] || validatingKeys[dp.id]}
                                title={settings?.[`${dp.key}_set`] ? "Retest API key" : "Test API key"}
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </button>
                        </div>
                        {settings?.[`${dp.key}_set`] && !directKeys[dp.key] && (
                            <div className="key-status set">✓ API key configured</div>
                        )}
                        {keyValidationStatus[dp.id] && (
                            <div className={`test-result ${keyValidationStatus[dp.id].success ? 'success' : 'error'}`}>
                                {keyValidationStatus[dp.id].message}
                            </div>
                        )}
                    </form>
                ))}
            </div>

            {/* Custom OpenAI-compatible Endpoint */}
            <div className="subsection" style={{ marginTop: '24px' }}>
                <h4>Custom OpenAI-Compatible Endpoint</h4>
                <p className="subsection-description" style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
                    Connect to any OpenAI-compatible API (Together AI, Fireworks, vLLM, LM Studio, etc.)
                </p>
                <form className="api-key-section" onSubmit={e => e.preventDefault()}>
                    <label>
                        <img src={customEndpointIcon} alt="" className="provider-icon" />
                        Display Name
                    </label>
                    <div className="api-key-input-row">
                        <input
                            type="text"
                            placeholder="e.g., Together AI, My vLLM Server"
                            value={customEndpointName}
                            onChange={(e) => setCustomEndpointName(e.target.value)}
                        />
                    </div>

                    <label style={{ marginTop: '12px' }}>Base URL</label>
                    <div className="api-key-input-row">
                        <input
                            type="text"
                            placeholder="https://api.together.xyz/v1"
                            value={customEndpointUrl}
                            onChange={(e) => setCustomEndpointUrl(e.target.value)}
                        />
                    </div>

                    <label style={{ marginTop: '12px' }}>API Key <span style={{ fontWeight: 'normal', opacity: 0.7 }}>(optional for local servers)</span></label>
                    <div className="api-key-input-row">
                        <input
                            type="password"
                            placeholder={settings?.custom_endpoint_url ? '••••••••••••••••' : 'Enter API key'}
                            value={customEndpointApiKey}
                            onChange={(e) => setCustomEndpointApiKey(e.target.value)}
                        />
                        {settings?.custom_endpoint_url && (
                            <button
                                type="button"
                                className="clear-icon-btn"
                                onClick={handleClearCustomEndpoint}
                                title="Clear endpoint configuration"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        )}
                        <button
                            className="retest-icon-btn"
                            onClick={handleTestCustomEndpoint}
                            disabled={!customEndpointName || !customEndpointUrl || isTestingCustomEndpoint}
                            title="Connect"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                    </div>

                    {/* Show configured status when endpoint is saved */}
                    {settings?.custom_endpoint_url && (
                        <div className="key-status set">
                            ✓ Endpoint configured
                            {customEndpointModels.length > 0 && ` · ${customEndpointModels.length} models available`}
                        </div>
                    )}
                    {customEndpointTestResult && (
                        <div className={`test-result ${customEndpointTestResult.success ? 'success' : 'error'}`}>
                            {customEndpointTestResult.message}
                        </div>
                    )}
                </form>
            </div>
        </section>
    );
}
