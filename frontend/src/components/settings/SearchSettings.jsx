import React from 'react';

const SEARCH_PROVIDERS = [
    {
        id: 'duckduckgo',
        name: 'DuckDuckGo',
        description: 'News search. Fast and free.',
        requiresKey: false,
        keyType: null,
    },
    {
        id: 'tavily',
        name: 'Tavily',
        description: 'Purpose-built for LLMs. Returns rich, relevant content. Requires API key.',
        requiresKey: true,
        keyType: 'tavily',
    },
    {
        id: 'brave',
        name: 'Brave Search',
        description: 'Privacy-focused search. 2,000 free queries/month. Requires API key.',
        requiresKey: true,
        keyType: 'brave',
    },
];

export default function SearchSettings({
    settings,
    selectedSearchProvider,
    setSelectedSearchProvider,
    // Tavily
    tavilyApiKey,
    setTavilyApiKey,
    handleTestTavily,
    isTestingTavily,
    tavilyTestResult,
    setTavilyTestResult,
    handleClearTavilyKey,
    // Brave
    braveApiKey,
    setBraveApiKey,
    handleTestBrave,
    isTestingBrave,
    braveTestResult,
    setBraveTestResult,
    handleClearBraveKey,
    // Firecrawl
    firecrawlApiKey,
    setFirecrawlApiKey,
    handleTestFirecrawl,
    isTestingFirecrawl,
    firecrawlTestResult,
    setFirecrawlTestResult,
    handleClearFirecrawlKey,
    // Other Settings
    fullContentResults,
    setFullContentResults,
    searchResultsCount,
    setSearchResultsCount,
    searchKeywordExtraction,
    setSearchKeywordExtraction
}) {
    return (
        <section className="settings-section">
            <h3>Web Search Provider</h3>
            <div className="provider-options">
                {SEARCH_PROVIDERS.map(provider => (
                    <div key={provider.id} className={`provider-option-container ${selectedSearchProvider === provider.id ? 'selected' : ''}`}>
                        <label className="provider-option">
                            <input
                                type="radio"
                                name="search_provider"
                                value={provider.id}
                                checked={selectedSearchProvider === provider.id}
                                onChange={() => setSelectedSearchProvider(provider.id)}
                            />
                            <div className="provider-info">
                                <span className="provider-name">{provider.name}</span>
                                <span className="provider-description">{provider.description}</span>
                            </div>
                        </label>

                        {/* Inline API Key Input for Tavily */}
                        {selectedSearchProvider === 'tavily' && provider.id === 'tavily' && (
                            <div className="inline-api-key-section">
                                <div className="api-key-input-row">
                                    <input
                                        type="password"
                                        placeholder={settings?.tavily_api_key_set ? '••••••••••••••••' : 'Enter Tavily API key'}
                                        value={tavilyApiKey}
                                        onChange={e => {
                                            setTavilyApiKey(e.target.value);
                                            if (setTavilyTestResult) setTavilyTestResult(null);
                                        }}
                                        className={settings?.tavily_api_key_set && !tavilyApiKey ? 'key-configured' : ''}
                                    />
                                    {settings?.tavily_api_key_set && !tavilyApiKey && (
                                        <button
                                            type="button"
                                            className="clear-icon-btn"
                                            onClick={handleClearTavilyKey}
                                            title="Clear API key"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="retest-icon-btn"
                                        onClick={handleTestTavily}
                                        disabled={isTestingTavily || (!tavilyApiKey && !settings?.tavily_api_key_set)}
                                        title={settings?.tavily_api_key_set && !tavilyApiKey ? "Retest API key" : "Test API key"}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    </button>
                                </div>
                                {settings?.tavily_api_key_set && !tavilyApiKey && (
                                    <div className="key-status set">✓ API key configured</div>
                                )}
                                {tavilyTestResult && (
                                    <div className={`test-result ${tavilyTestResult.success ? 'success' : 'error'}`}>
                                        {tavilyTestResult.success ? '✓' : '✗'} {tavilyTestResult.message}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Inline API Key Input for Brave */}
                        {selectedSearchProvider === 'brave' && provider.id === 'brave' && (
                            <div className="inline-api-key-section">
                                <div className="api-key-input-row">
                                    <input
                                        type="password"
                                        placeholder={settings?.brave_api_key_set ? '••••••••••••••••' : 'Enter Brave API key'}
                                        value={braveApiKey}
                                        onChange={e => {
                                            setBraveApiKey(e.target.value);
                                            if (setBraveTestResult) setBraveTestResult(null);
                                        }}
                                        className={settings?.brave_api_key_set && !braveApiKey ? 'key-configured' : ''}
                                    />
                                    {settings?.brave_api_key_set && !braveApiKey && (
                                        <button
                                            type="button"
                                            className="clear-icon-btn"
                                            onClick={handleClearBraveKey}
                                            title="Clear API key"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="retest-icon-btn"
                                        onClick={handleTestBrave}
                                        disabled={isTestingBrave || (!braveApiKey && !settings?.brave_api_key_set)}
                                        title={settings?.brave_api_key_set && !braveApiKey ? "Retest API key" : "Test API key"}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    </button>
                                </div>
                                {settings?.brave_api_key_set && !braveApiKey && (
                                    <div className="key-status set">✓ API key configured</div>
                                )}
                                {braveTestResult && (
                                    <div className={`test-result ${braveTestResult.success ? 'success' : 'error'}`}>
                                        {braveTestResult.success ? '✓' : '✗'} {braveTestResult.message}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="full-content-section">
                <label>Search Results</label>
                <p className="setting-description">
                    Number of search results to fetch from the search engine.
                </p>
                <div className="full-content-input-row">
                    <input
                        type="range"
                        min="1"
                        max="10"
                        value={searchResultsCount}
                        onChange={e => setSearchResultsCount(parseInt(e.target.value, 10))}
                        className="full-content-slider"
                    />
                    <span className="full-content-value">{searchResultsCount} results</span>
                </div>
            </div>

            <div className="full-content-section">
                <label>Full Article Fetch</label>
                <p className="setting-description">
                    Reads the full text of the top search results using Jina AI (free, default) or
                    Firecrawl (if API key configured below). <strong>Set to 0 to disable.</strong>
                </p>
                <div className="full-content-input-row">
                    <input
                        type="range"
                        min="0"
                        max="5"
                        value={fullContentResults}
                        onChange={e => setFullContentResults(parseInt(e.target.value, 10))}
                        className="full-content-slider"
                    />
                    <span className="full-content-value">{fullContentResults} results</span>
                </div>
            </div>

            <div className="api-key-section" style={{ marginTop: '16px' }}>
                <label>Firecrawl API Key <span style={{ fontWeight: 400, opacity: 0.6 }}>(Optional)</span></label>
                <p className="setting-description">
                    Replaces Jina AI for full content fetching. Faster, more reliable, and handles
                    JavaScript-heavy sites. Leave blank to use Jina AI (free).
                </p>
                <div className="api-key-input-row">
                    <input
                        type="password"
                        placeholder={settings?.firecrawl_api_key_set ? '••••••••••••••••' : 'Enter Firecrawl API key'}
                        value={firecrawlApiKey}
                        onChange={e => {
                            setFirecrawlApiKey(e.target.value);
                            if (setFirecrawlTestResult) setFirecrawlTestResult(null);
                        }}
                        className={settings?.firecrawl_api_key_set && !firecrawlApiKey ? 'key-configured' : ''}
                    />
                    {settings?.firecrawl_api_key_set && !firecrawlApiKey && (
                        <button
                            type="button"
                            className="clear-icon-btn"
                            onClick={handleClearFirecrawlKey}
                            title="Clear API key"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    )}
                    <button
                        type="button"
                        className="retest-icon-btn"
                        onClick={handleTestFirecrawl}
                        disabled={isTestingFirecrawl || (!firecrawlApiKey && !settings?.firecrawl_api_key_set)}
                        title={settings?.firecrawl_api_key_set && !firecrawlApiKey ? "Retest API key" : "Test API key"}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                </div>
                {settings?.firecrawl_api_key_set && !firecrawlApiKey && (
                    <div className="key-status set">✓ API key configured</div>
                )}
                {firecrawlTestResult && (
                    <div className={`test-result ${firecrawlTestResult.success ? 'success' : 'error'}`}>
                        {firecrawlTestResult.success ? '✓' : '✗'} {firecrawlTestResult.message}
                    </div>
                )}
            </div>

            <div className="keyword-extraction-section" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <label>Search Query Processing</label>
                <p className="setting-description">
                    Choose how your prompt is sent to the search engine.
                </p>

                <div className="provider-options">
                    <div className={`provider-option-container ${searchKeywordExtraction === 'direct' ? 'selected' : ''}`}>
                        <label className="provider-option">
                            <input
                                type="radio"
                                name="keyword_extraction"
                                value="direct"
                                checked={searchKeywordExtraction === 'direct'}
                                onChange={() => setSearchKeywordExtraction('direct')}
                            />
                            <div className="provider-info">
                                <span className="provider-name">Direct (Recommended)</span>
                                <span className="provider-description">
                                    Send your exact query to the search engine. Best for modern semantic search engines like Tavily and Brave.
                                </span>
                            </div>
                        </label>
                    </div>

                    <div className={`provider-option-container ${searchKeywordExtraction === 'yake' ? 'selected' : ''}`}>
                        <label className="provider-option">
                            <input
                                type="radio"
                                name="keyword_extraction"
                                value="yake"
                                checked={searchKeywordExtraction === 'yake'}
                                onChange={() => setSearchKeywordExtraction('yake')}
                            />
                            <div className="provider-info">
                                <span className="provider-name">Smart Keywords (Yake)</span>
                                <span className="provider-description">
                                    Extract key terms from your prompt before searching. Useful if you paste very long prompts that confuse the search engine.
                                </span>
                            </div>
                        </label>
                    </div>
                </div>
            </div>
        </section>
    );
}
