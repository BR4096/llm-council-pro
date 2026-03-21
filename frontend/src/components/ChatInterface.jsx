import StageTimer from './StageTimer';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SearchContext from './SearchContext';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import Stage4 from './Stage4';
import Stage5 from './Stage5';
import CouncilGrid from './CouncilGrid';
import ExecutionModeToggle from './ExecutionModeToggle';
import { api, exportConversation } from '../api';
import './ChatInterface.css';

export default function ChatInterface({
    conversation,
    onSendMessage,
    onAbort,
    isLoading,
    councilConfigured,
    onOpenSettings,
    councilModels = [],
    chairmanModel = null,
    executionMode,
    onExecutionModeChange,
    searchProvider = 'duckduckgo',
    characterNames = {},
    chairmanCharacterName = '',
    presets = [],
    onLoadPreset,
    onNewDiscussion,
    onClearCouncilConfig,
    showToast,
    dictationLanguage,
    truthCheck: initialTruthCheck = false,
    onTruthCheckChange,
    debate: initialDebate = false,
    onDebateChange,
    onRunDebate,
    debateGatewayActive = false,
    debatePending = false,
    onProceedToSynthesis,
    isFollowUpMode = false,
    followUpCount = 0,
    maxFollowUps = 5,
}) {
    const [input, setInput] = useState('');
    const [webSearch, setWebSearch] = useState(false);
    const [truthCheck, setTruthCheck] = useState(initialTruthCheck);
    const [debate, setDebate] = useState(initialDebate);
    const [showPresetPopover, setShowPresetPopover] = useState(false);
    const [showExportPopover, setShowExportPopover] = useState(false);
    const [exportToast, setExportToast] = useState(null);
    const [isListening, setIsListening] = useState(false);
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const presetButtonRef = useRef(null);
    const exportButtonRef = useRef(null);
    const recognitionRef = useRef(null);

    // Saved chat = conversation exists and has messages
    const isSavedChat = conversation && conversation.messages?.length > 0;

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Only auto-scroll if user is already near the bottom
    // This prevents interrupting reading when new content arrives
    useEffect(() => {
        if (!messagesContainerRef.current) return;

        const container = messagesContainerRef.current;
        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 150;

        // Auto-scroll only if user is already at/near bottom
        if (isNearBottom) {
            scrollToBottom();
        }
    }, [conversation]);

    const handleTruthCheckToggle = () => {
        const newVal = !truthCheck;
        setTruthCheck(newVal);
        if (onTruthCheckChange) onTruthCheckChange(newVal);
    };

    const handleDebateToggle = () => {
        const newVal = !debate;
        setDebate(newVal);
        if (onDebateChange) onDebateChange(newVal);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (input.trim() && !isLoading) {
            onSendMessage(input, webSearch, truthCheck, debate);
            setInput('');
        }
    };

    const handleKeyDown = (e) => {
        // Submit on Enter (without Shift)
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const toggleDictation = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            // Browser not supported - button is hidden, but defensive check
            return;
        }

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        const recognition = new SpeechRecognition();
        // Hybrid language: use Settings override, or fall back to browser language
        recognition.lang = dictationLanguage || navigator.language || 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            setInput(transcript);
        };

        recognition.onerror = (event) => {
            if (event.error === 'not-allowed') {
                showToast('Microphone access denied. Enable it in browser settings.');
            }
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
    };

    // Close preset popover when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (presetButtonRef.current && !presetButtonRef.current.contains(e.target)) {
                setShowPresetPopover(false);
            }
        };
        if (showPresetPopover) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showPresetPopover]);

    // Close export popover when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (exportButtonRef.current && !exportButtonRef.current.contains(e.target)) {
                setShowExportPopover(false);
            }
        };
        if (showExportPopover) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showExportPopover]);

    const handleRefreshCouncil = async () => {
        // Clear council config first
        if (onClearCouncilConfig) {
            await onClearCouncilConfig();
        }
        // Open new discussion
        if (onNewDiscussion) {
            onNewDiscussion();
        }
        // Open settings to council config section
        if (onOpenSettings) {
            onOpenSettings('council');
        }
    };

    const handleExport = async (format) => {
        setShowExportPopover(false);
        if (!conversation?.id) return;

        try {
            const blob = await exportConversation(conversation.id, format);
            const url = URL.createObjectURL(blob);

            // Extract filename from Content-Disposition or generate one
            const ext = format === 'markdown' ? 'md' : format;
            const filename = `conversation-${conversation.id.slice(0, 8)}.${ext}`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            const formatNames = { markdown: 'Markdown', pdf: 'PDF', docx: 'Word' };
            // Show local toast near export button
            setExportToast({ message: `Exported to ${formatNames[format]}`, type: 'success' });
            setTimeout(() => setExportToast(null), 2500);
        } catch (err) {
            console.error('Export error:', err);
            setExportToast({ message: 'Export failed. Please try again.', type: 'error' });
            setTimeout(() => setExportToast(null), 2500);
        }
    };

    if (!conversation) {
        return (
            <div className="chat-interface">
                <div className="empty-state">
                    <div className="hero-image-container">
                        <img
                            src="/assets/llm-council-pro-table.png"
                            alt="LLM Council Pro"
                            className="hero-image"
                        />
                        <div className="hero-overlay">
                            <h1 className="hero-title">LLM Council <span className="plus-text">Pro</span></h1>
                            <p className="hero-tagline">The Deliberative Reasoning Engine</p>
                        </div>
                    </div>

                    {/* Council Preview Grid */}
                    <div className="welcome-grid-container">
                        <CouncilGrid
                            models={councilModels}
                            chairman={chairmanModel}
                            status="idle"
                            characterNames={characterNames}
                            chairmanCharacterName={chairmanCharacterName}
                        />
                    </div>

                    {/* Configure Council Button */}
                    <button className="config-button" onClick={() => onOpenSettings('council')}>CONFIGURE COUNCIL</button>

                </div>

                {/* Input bar for empty state */}
                <div className="input-area">
                    {!councilConfigured ? (
                        <div className="input-container config-required">
                            <span className="config-message">
                                Council not ready.
                                <button className="config-link" onClick={() => onOpenSettings('llm_keys')}>Configure API Keys</button>
                                <span className="config-separator">or</span>
                                <button className="config-link" onClick={() => onOpenSettings('council')}>Configure Council</button>
                            </span>
                        </div>
                    ) : (
                        <form className="input-container" onSubmit={handleSubmit}>
                            <div className="input-row-top">
                                <label className={`search-toggle ${webSearch ? 'active' : ''}`}>
                                    <input
                                        type="checkbox"
                                        className="search-checkbox"
                                        checked={webSearch}
                                        onChange={() => setWebSearch(!webSearch)}
                                        disabled={isLoading}
                                    />
                                    <span className="search-icon">🌐</span>
                                    {webSearch && <span className="search-label">Search On</span>}
                                </label>

                                <textarea
                                    className="message-input"
                                    placeholder={isLoading ? "Consulting..." : "Ask the Council..."}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    disabled={isLoading}
                                    rows={1}
                                    style={{ height: 'auto', minHeight: '24px' }}
                                />

                                {/* Dictation Button - only show if browser supports it */}
                                {typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition) && (
                                    <button
                                        type="button"
                                        className={`dictation-button ${isListening ? 'listening' : ''}`}
                                        onClick={toggleDictation}
                                        disabled={isLoading}
                                    >
                                        {isListening ? '⏹' : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" x2="12" y1="19" y2="22"/>
        <line x1="8" x2="16" y1="22" y2="22"/>
    </svg>
)}
                                    </button>
                                )}

                                {isLoading ? (
                                    <button type="button" className="send-button stop-button" onClick={onAbort}>
                                        ⏹
                                    </button>
                                ) : (
                                    <button type="submit" className="send-button" disabled={!input.trim()}>
                                        ➤
                                    </button>
                                )}
                            </div>

                            <div className="input-row-bottom">
                                <button
                                    className="refresh-council-button"
                                    onClick={handleRefreshCouncil}
                                    disabled={isLoading}
                                >
                                    <span className="refresh-icon">&#8634;</span>
                                </button>
                                {/* Preset Button + Popover */}
                                {presets.length > 0 && (
                                    <div className="preset-container" ref={presetButtonRef}>
                                        <button
                                            className="preset-button"
                                            onClick={() => setShowPresetPopover(!showPresetPopover)}
                                            disabled={isLoading}
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="4" y1="21" x2="4" y2="14"/>
                                                <line x1="4" y1="10" x2="4" y2="3"/>
                                                <line x1="12" y1="21" x2="12" y2="12"/>
                                                <line x1="12" y1="8" x2="12" y2="3"/>
                                                <line x1="20" y1="21" x2="20" y2="16"/>
                                                <line x1="20" y1="12" x2="20" y2="3"/>
                                                <line x1="1" y1="14" x2="7" y2="14"/>
                                                <line x1="9" y1="8" x2="15" y2="8"/>
                                                <line x1="17" y1="16" x2="23" y2="16"/>
                                            </svg>
                                        </button>

                                        {showPresetPopover && (
                                            <div className="preset-popover">
                                                <div className="preset-popover-header">Load Preset</div>
                                                <div className="preset-popover-list">
                                                    {presets.map(preset => (
                                                        <button
                                                            key={preset.name}
                                                            className="preset-popover-item"
                                                            onClick={() => {
                                                                if (onLoadPreset) {
                                                                    onLoadPreset(preset.config);
                                                                }
                                                                setShowPresetPopover(false);
                                                            }}
                                                        >
                                                            <span className="preset-item-name">{preset.name}</span>
                                                            <span className="preset-item-count">
                                                                {preset.config?.council_models?.length || 0} models
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <ExecutionModeToggle
                                    value={executionMode}
                                    onChange={onExecutionModeChange}
                                    disabled={isLoading}
                                />
                                {executionMode === 'full' && (
                                    <label
                                        className={`truth-check-toggle ${truthCheck ? 'active' : ''}`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="search-checkbox"
                                            checked={truthCheck}
                                            onChange={handleTruthCheckToggle}
                                            disabled={isLoading}
                                        />
                                        <span className="search-icon">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                                <polyline points="22 4 12 14.01 9 11.01"/>
                                            </svg>
                                        </span>
                                    </label>
                                )}
                                {executionMode === 'full' && (
                                    <label
                                        className={`debate-toggle ${debate ? 'active' : ''}`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="search-checkbox"
                                            checked={debate}
                                            onChange={handleDebateToggle}
                                            disabled={isLoading}
                                        />
                                        <span className="search-icon">
                                            <svg width="20" height="20" viewBox="0 0 36 36" fill="currentColor">
                                                <path d="M23,26a1,1,0,0,1-1,1H8c-.22,0-.43.2-.61.33L4,30V14a1,1,0,0,1,1-1H8.86V11H5a3,3,0,0,0-3,3V32a1,1,0,0,0,.56.89,1,1,0,0,0,1-.1L8.71,29H22.15A2.77,2.77,0,0,0,25,26.13V25H23Z"/>
                                                <path d="M31,4H14a3,3,0,0,0-3,3V19a3,3,0,0,0,3,3H27.55l4.78,3.71a1,1,0,0,0,1,.11,1,1,0,0,0,.57-.9V7A3,3,0,0,0,31,4ZM32,22.94,28.5,20.21a1,1,0,0,0-.61-.21H14a1,1,0,0,1-1-1V7a1,1,0,0,1,1-1H31A1.1,1.1,0,0,1,32,7.06Z"/>
                                            </svg>
                                        </span>
                                    </label>
                                )}
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="chat-interface">
            {/* Messages Area */}
            <div className="messages-area" ref={messagesContainerRef}>
                {(!conversation || conversation.messages.length === 0) ? (
                    <div className="hero-container">
                        <div className="hero-content">
                            <img src="/assets/llmc-pro-128.png" alt="LLM Council Logo" className="council-logo" />
                            <h1>Welcome to LLM Council <span className="text-gradient">Pro</span></h1>
                            <p className="hero-subtitle">
                                The Deliberative Reasoning Engine <button className="config-link" onClick={() => onOpenSettings('council')}>Configure it</button>
                            </p>
                            <div className="welcome-grid-container">
                                <CouncilGrid
                                    models={councilModels}
                                    chairman={chairmanModel}
                                    status="idle"
                                    characterNames={characterNames}
                                    chairmanCharacterName={chairmanCharacterName}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    conversation.messages.map((msg, index) => (
                        <div key={index} className={`message ${msg.role}`}>
                            <div className="message-header">
                                <div className="message-role">
                                    {msg.role === 'user'
                                        ? (msg.type === 'follow_up' ? 'Your Follow-Up' : 'Your Question to the Council')
                                        : (msg.type === 'follow_up' ? 'Chairman' : 'LLM Council')}
                                </div>
                                {msg.role === 'user' && !msg.type && (
                                    <div className="export-container" ref={exportButtonRef}>
                                        <button
                                            className="export-button"
                                            onClick={() => setShowExportPopover(!showExportPopover)}
                                            title="Export conversation"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                <polyline points="7,10 12,15 17,10"/>
                                                <line x1="12" y1="15" x2="12" y2="3"/>
                                            </svg>
                                        </button>
                                        {showExportPopover && (
                                            <div className="export-dropdown">
                                                <button onClick={() => handleExport('markdown')}>
                                                    Markdown (.md)
                                                </button>
                                                <button onClick={() => handleExport('pdf')}>
                                                    PDF (.pdf)
                                                </button>
                                                <button onClick={() => handleExport('docx')}>
                                                    Word (.docx)
                                                </button>
                                            </div>
                                        )}
                                        {exportToast && (
                                            <div className={`export-toast toast-${exportToast.type}`}>
                                                {exportToast.message}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="message-content">
                                {msg.role === 'user' ? (
                                    <div className="markdown-content">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                    </div>
                                ) : msg.type === 'follow_up' ? (
                                    <div className="follow-up-response">
                                        {msg.loading?.stage5 ? (
                                            <div className="stage-loading">
                                                <div className="spinner"></div>
                                                <span>Chairman is thinking...</span>
                                            </div>
                                        ) : msg.stage5 ? (
                                            <Stage5
                                                finalResponse={msg.stage5}
                                                chairmanCharacterName={chairmanCharacterName}
                                                councilModels={councilModels}
                                                characterNames={characterNames}
                                                isFollowUp={true}
                                            />
                                        ) : null}
                                    </div>
                                ) : (
                                    <>
                                        {/* Search Loading */}
                                        {msg.loading?.search && (
                                            <div className="stage-loading">
                                                <div className="spinner"></div>
                                                <span>
                                                    Searching the web with {
                                                        searchProvider === 'duckduckgo' ? 'DuckDuckGo' :
                                                            searchProvider === 'tavily' ? 'Tavily' :
                                                                searchProvider === 'brave' ? 'Brave' :
                                                                    'Provider'
                                                    }...
                                                </span>
                                            </div>
                                        )}

                                        {/* Sources Heading - appears above the SearchContext container */}
                                        {(() => {
                                            if (!msg.metadata?.search_context) return null;
                                            // Parse sources to check if any exist
                                            const blocks = msg.metadata.search_context.split(/Result \d+:/);
                                            const hasSources = blocks.some(block => {
                                                const titleMatch = block.match(/Title:\s*(.+)/);
                                                const urlMatch = block.match(/URL:\s*(.+)/);
                                                return titleMatch && urlMatch;
                                            });
                                            return hasSources ? (
                                                <div className="stage-header" style={{ paddingBottom: '16px' }}>
                                                    <h3 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: '0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span className="stage-icon">🔍</span>
                                                        Sources
                                                    </h3>
                                                </div>
                                            ) : null;
                                        })()}

                                        {/* Search Context */}
                                        {msg.metadata?.search_context && (
                                            <SearchContext
                                                searchQuery={msg.metadata?.search_query}
                                                extractedQuery={msg.metadata?.extracted_query}
                                                searchContext={msg.metadata?.search_context}
                                            />
                                        )}

                                        {/* Stage 1: Council Grid Visualization */}
                                        {(msg.loading?.stage1 || msg.stage1) && (
                                            <div className="stage-container">
                                                <div className="stage-header" style={{ paddingBottom: '16px' }}>
                                                    <h3 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: '0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span className="stage-icon">🏛️</span>
                                                        Council Deliberation
                                                    </h3>
                                                </div>
                                                <CouncilGrid
                                                    models={councilModels} // Use the same models list
                                                    chairman={chairmanModel}
                                                    status={msg.loading?.stage1 ? 'thinking' : 'complete'}
                                                    progress={{
                                                        currentModel: msg.progress?.stage1?.currentModel,
                                                        completed: msg.stage1?.map(r => r.model) || []
                                                    }}
                                                    characterNames={characterNames}
                                                    chairmanCharacterName={chairmanCharacterName}
                                                    isFollowUpMode={isFollowUpMode}
                                                />
                                                {/* Stage 1 Loading Indicator */}
                                                {msg.loading?.stage1 && (
                                                    <div className="stage-loading">
                                                        <div className="spinner"></div>
                                                        <span>Running Council Deliberation...</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Stage 1 Results (Accordion/List - kept for detail view) */}
                                        {msg.stage1 && (
                                            <Stage1
                                                responses={msg.stage1}
                                                startTime={msg.timers?.stage1Start}
                                                endTime={msg.timers?.stage1End}
                                                characterNames={characterNames}
                                                councilModels={councilModels}
                                            />
                                        )}

                                        {/* Stage 2 */}
                                        {(msg.loading?.stage2 || msg.stage2) && (
                                            <Stage2
                                                rankings={msg.stage2}
                                                labelToModel={msg.metadata?.label_to_model}
                                                labelToInstanceKey={msg.metadata?.label_to_instance_key}
                                                aggregateRankings={msg.metadata?.aggregate_rankings}
                                                startTime={msg.timers?.stage2Start}
                                                endTime={msg.timers?.stage2End}
                                                characterNames={characterNames}
                                                councilModels={councilModels}
                                                isLoading={!!msg.loading?.stage2}
                                            />
                                        )}

                                        {/* Stage 3: Revision */}
                                        {msg.loading?.stage3 && (
                                            <div className="stage-loading">
                                                <div className="spinner"></div>
                                                <span>Revising responses... {msg.progress?.stage3?.count > 0 ? `${msg.progress.stage3.count}/${msg.progress.stage3.total}` : ''}</span>
                                            </div>
                                        )}
                                        {msg.stage3 && (
                                            <Stage3
                                                responses={msg.stage3}
                                                startTime={msg.timers?.stage3Start}
                                                endTime={msg.timers?.stage3End}
                                                characterNames={characterNames}
                                                councilModels={councilModels}
                                            />
                                        )}

                                        {/* Stage 4: Chairman Analysis */}
                                        {(msg.loading?.stage4 || msg.stage4) && (
                                            <Stage4
                                                stage4Data={msg.stage4}
                                                stage4Status={msg.loading?.stage4 ? 'loading' : 'complete'}
                                                startTime={msg.timers?.stage4Start}
                                                endTime={msg.timers?.stage4End}
                                                labelToModel={msg.metadata?.label_to_model || {}}
                                                characterNames={characterNames}
                                                councilModels={councilModels}
                                                onRunDebate={onRunDebate}
                                                debateGatewayActive={debateGatewayActive}
                                                debatePending={debatePending}
                                                onProceedToSynthesis={onProceedToSynthesis}
                                            />
                                        )}


                                        {/* Stage 5: Chairman Synthesis — hidden while debate gateway is active */}
                                        {!debateGatewayActive && msg.loading?.stage5 && (
                                            <div className="stage-loading">
                                                <div className="spinner"></div>
                                                <span>Running Stage 5...</span>
                                            </div>
                                        )}
                                        {!debateGatewayActive && msg.stage5 && (
                                            <Stage5
                                                finalResponse={msg.stage5}
                                                startTime={msg.timers?.stage5Start}
                                                endTime={msg.timers?.stage5End}
                                                chairmanCharacterName={chairmanCharacterName}
                                                councilModels={councilModels}
                                                characterNames={characterNames}
                                                debateCount={msg.stage4?.gateway_issues ? {
                                                    run: (msg.stage4?.debates || []).filter(d => d.status === 'completed').length,
                                                    total: msg.stage4.gateway_issues.length
                                                } : null}
                                            />
                                        )}

                                        {/* Aborted Indicator */}
                                        {msg.aborted && (
                                            <div className="aborted-indicator">
                                                <span className="aborted-icon">⏹</span>
                                                <span className="aborted-text">
                                                    Generation stopped by user.
                                                    {msg.stage1 && !msg.stage5 && ' Partial results shown above.'}
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))
                )}

                {/* Bottom Spacer for floating input */}
                <div ref={messagesEndRef} style={{ height: '20px' }} />
            </div>

            {/* Floating Command Capsule */}
            <div className="input-area">
                {!councilConfigured ? (
                    <div className="input-container config-required">
                        <span className="config-message">
                            ⚠️ Council not ready.
                            <button className="config-link" onClick={() => onOpenSettings('llm_keys')}>Configure API Keys</button>
                            <span className="config-separator">or</span>
                            <button className="config-link" onClick={() => onOpenSettings('council')}>Configure Council</button>
                        </span>
                    </div>
                ) : (
                    <>
                    <form className="input-container" onSubmit={handleSubmit}>
                        <div className="input-row-top">
                            <label className={`search-toggle ${webSearch ? 'active' : ''}`}>
                                <input
                                    type="checkbox"
                                    className="search-checkbox"
                                    checked={webSearch}
                                    onChange={() => setWebSearch(!webSearch)}
                                    disabled={isLoading}
                                />
                                <span className="search-icon">🌐</span>
                                {webSearch && <span className="search-label">Search On</span>}
                            </label>

                            <textarea
                                className="message-input"
                                placeholder={isLoading ? "Consulting..." : (isFollowUpMode && followUpCount >= maxFollowUps) ? "Thread limit reached. Start a new discussion." : isFollowUpMode ? "Follow up with the chairman..." : "Ask the Council..."}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={isLoading || (isFollowUpMode && followUpCount >= maxFollowUps)}
                                rows={1}
                                style={{ height: 'auto', minHeight: '24px' }}
                            />

                            {/* Dictation Button - only show if browser supports it */}
                            {typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition) && (
                                <button
                                    type="button"
                                    className={`dictation-button ${isListening ? 'listening' : ''}`}
                                    onClick={toggleDictation}
                                    disabled={isLoading}
                                >
                                    {isListening ? '⏹' : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" x2="12" y1="19" y2="22"/>
        <line x1="8" x2="16" y1="22" y2="22"/>
    </svg>
)}
                                </button>
                            )}

                            {isLoading ? (
                                <button type="button" className="send-button stop-button" onClick={onAbort}>
                                    ⏹
                                </button>
                            ) : (
                                <button type="submit" className="send-button" disabled={!input.trim()}>
                                    ➤
                                </button>
                            )}
                        </div>

                        <div className="input-row-bottom">
                            <button
                                className="refresh-council-button"
                                onClick={handleRefreshCouncil}
                                disabled={isLoading}

                            >
                                <span className="refresh-icon">&#8634;</span>
                            </button>
                            {/* Preset Button + Popover */}
                            {presets.length > 0 && (
                                <div className="preset-container" ref={presetButtonRef}>
                                    <button
                                        className="preset-button"
                                        onClick={() => setShowPresetPopover(!showPresetPopover)}
                                        disabled={isLoading || isSavedChat}
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="4" y1="21" x2="4" y2="14"/>
                                            <line x1="4" y1="10" x2="4" y2="3"/>
                                            <line x1="12" y1="21" x2="12" y2="12"/>
                                            <line x1="12" y1="8" x2="12" y2="3"/>
                                            <line x1="20" y1="21" x2="20" y2="16"/>
                                            <line x1="20" y1="12" x2="20" y2="3"/>
                                            <line x1="1" y1="14" x2="7" y2="14"/>
                                            <line x1="9" y1="8" x2="15" y2="8"/>
                                            <line x1="17" y1="16" x2="23" y2="16"/>
                                        </svg>
                                    </button>

                                    {showPresetPopover && !isSavedChat && (
                                        <div className="preset-popover">
                                            <div className="preset-popover-header">Load Preset</div>
                                            <div className="preset-popover-list">
                                                {presets.map(preset => (
                                                    <button
                                                        key={preset.name}
                                                        className="preset-popover-item"
                                                        onClick={() => {
                                                            if (onLoadPreset) {
                                                                onLoadPreset(preset.config);
                                                            }
                                                            setShowPresetPopover(false);
                                                        }}
                                                    >
                                                        <span className="preset-item-name">{preset.name}</span>
                                                        <span className="preset-item-count">
                                                            {preset.config?.council_models?.length || 0} models
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <ExecutionModeToggle
                                value={executionMode}
                                onChange={onExecutionModeChange}
                                disabled={isLoading}
                            />
                            {executionMode === 'full' && (
                                <label
                                    className={`truth-check-toggle ${truthCheck ? 'active' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        className="search-checkbox"
                                        checked={truthCheck}
                                        onChange={handleTruthCheckToggle}
                                        disabled={isLoading}
                                    />
                                    <span className="search-icon">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                            <polyline points="22 4 12 14.01 9 11.01"/>
                                        </svg>
                                    </span>
                                </label>
                            )}
                            {executionMode === 'full' && (
                                <label
                                    className={`debate-toggle ${debate ? 'active' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        className="search-checkbox"
                                        checked={debate}
                                        onChange={handleDebateToggle}
                                        disabled={isLoading}
                                    />
                                    <span className="search-icon">
                                        <svg width="20" height="20" viewBox="0 0 36 36" fill="currentColor">
                                            <path d="M23,26a1,1,0,0,1-1,1H8c-.22,0-.43.2-.61.33L4,30V14a1,1,0,0,1,1-1H8.86V11H5a3,3,0,0,0-3,3V32a1,1,0,0,0,.56.89,1,1,0,0,0,1-.1L8.71,29H22.15A2.77,2.77,0,0,0,25,26.13V25H23Z"/>
                                            <path d="M31,4H14a3,3,0,0,0-3,3V19a3,3,0,0,0,3,3H27.55l4.78,3.71a1,1,0,0,0,1,.11,1,1,0,0,0,.57-.9V7A3,3,0,0,0,31,4ZM32,22.94,28.5,20.21a1,1,0,0,0-.61-.21H14a1,1,0,0,1-1-1V7a1,1,0,0,1,1-1H31A1.1,1.1,0,0,1,32,7.06Z"/>
                                        </svg>
                                    </span>
                                </label>
                            )}
                        </div>
                    </form>
                    </>
                )}
            </div>
        </div>
    );
}
