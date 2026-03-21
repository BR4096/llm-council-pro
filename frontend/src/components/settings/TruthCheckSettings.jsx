import React from 'react';

const TRUTH_CHECK_PROVIDERS = [
    {
        id: 'duckduckgo',
        name: 'DuckDuckGo',
        description: 'News search. Fast and free.',
        requiresKey: false,
    },
    {
        id: 'tavily',
        name: 'Tavily',
        description: 'Purpose-built for LLMs. Returns rich, relevant content.',
        requiresKey: true,
        keyLabel: 'Tavily API key',
    },
    {
        id: 'brave',
        name: 'Brave Search',
        description: 'Privacy-focused search. 2,000 free queries/month.',
        requiresKey: true,
        keyLabel: 'Brave API key',
    },
];

export default function TruthCheckSettings({ selectedProvider, setSelectedProvider, hasTavilyKey, hasBraveKey }) {
    const isEnabled = (provider) => {
        if (!provider.requiresKey) return true;
        if (provider.id === 'tavily') return !!hasTavilyKey;
        if (provider.id === 'brave') return !!hasBraveKey;
        return true;
    };

    return (
        <section className="settings-section">
            <h3>Truth Check Provider</h3>
            <p className="setting-description">
                Choose which search provider the truth-check pipeline uses to verify claims. Defaults to Web Search provider until changed.
            </p>
            <div className="provider-options">
                {TRUTH_CHECK_PROVIDERS.map(provider => {
                    const enabled = isEnabled(provider);
                    return (
                        <div
                            key={provider.id}
                            className={`provider-option-container ${selectedProvider === provider.id ? 'selected' : ''} ${!enabled ? 'disabled' : ''}`}
                        >
                            <label className={`provider-option ${!enabled ? 'disabled' : ''}`}>
                                <input
                                    type="radio"
                                    name="truth_check_provider"
                                    value={provider.id}
                                    checked={selectedProvider === provider.id}
                                    onChange={() => enabled && setSelectedProvider(provider.id)}
                                    disabled={!enabled}
                                />
                                <div className="provider-info">
                                    <span className="provider-name">{provider.name}</span>
                                    <span className="provider-description">
                                        {provider.description}
                                        {!enabled && (
                                            <span className="provider-key-required"> Requires {provider.keyLabel} (configure in Search Providers).</span>
                                        )}
                                    </span>
                                </div>
                            </label>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
