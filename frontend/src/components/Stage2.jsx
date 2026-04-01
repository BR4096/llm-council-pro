import { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getModelVisuals, getShortModelName, buildDisplayNames } from '../utils/modelHelpers';
import CopyButton from './CopyButton';
import './Stage2.css';
import './CopyButton.css';
import StageTimer from './StageTimer';

// Multi-language ranking section headers — used to strip the ranking list from displayed text.
// Supports English, French, Spanish, and German (mirrors RANKING_PATTERNS in backend/council.py).
const RANKING_HEADERS = [
    /FINAL\s*RANKING:/i,
    /CLASSEMENT\s*FINAL:/i,
    /RANG\s*FINAL:/i,
    /CLASIFICACI[ÓO]N\s*FINAL:/i,
    /RANKING\s*FINAL:/i,
    /ENDG[ÜU]LTIGE\s*RANGFOLGE:/i,
    /FINALE\s*WERTUNG:/i,
];

// Response label words in supported languages — used to replace anonymized labels
// with bold character/model names in the raw evaluation text.
const RESPONSE_LABELS = ['Response', 'R[eé]ponse', 'Respuesta', 'Antwort'];

function deAnonymizeText(text, labelToModel, labelToInstanceKey, characterNames = {}, councilModels = [], displayNames = {}) {
    let result = text;
    const modelNames = new Set();

    // Always strip the final ranking section from displayed text,
    // regardless of whether labelToModel is available yet.
    // Use LAST occurrence since models may mention "final ranking" mid-text
    // but the actual ranking section is always at the end.
    for (const headerPattern of RANKING_HEADERS) {
        const regex = new RegExp(headerPattern.source, 'gi');
        const matches = [...result.matchAll(regex)];
        if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            result = result.substring(0, lastMatch.index).trim();
            break;
        }
    }

    if (!labelToModel) return { text: result, modelNames: [] };

    // Replace each "Response X" (and its language variants) with the actual model name in bold.
    // The backend normalizes parsed labels to "Response X" English format, so labelToModel keys
    // are always English (e.g. "Response A"). However the raw ranking text shown here may contain
    // French "Réponse A", Spanish "Respuesta A", or German "Antwort A" — we replace all variants.
    Object.entries(labelToModel).forEach(([label, model]) => {
        // Get instance index from labelToInstanceKey for accurate character name lookup
        const instanceKey = labelToInstanceKey?.[label];
        let instanceIndex = -1;
        if (instanceKey) {
            const match = instanceKey.match(/:(\d+)$/);
            if (match) instanceIndex = parseInt(match[1]);
        }

        // Fallback to findIndex if no instance key (backward compatibility)
        if (instanceIndex < 0) {
            instanceIndex = councilModels.findIndex(m => m === model);
        }

        const characterName = instanceIndex >= 0 ? characterNames?.[instanceIndex] : null;
        const displayName = (instanceIndex >= 0 && displayNames?.[instanceIndex]) || characterName || getShortModelName(model);
        modelNames.add(displayName);
        modelNames.add(`${displayName}:`); // Also add version with colon

        // Extract the letter from the English label (e.g. "A" from "Response A")
        const letter = label.split(' ').pop();

        // Build pattern matching all language variants for this letter
        const labelPattern = RESPONSE_LABELS.map(l => `${l}\\s+${letter}`).join('|');
        const regex = new RegExp(`(${labelPattern})(?!\\w)(:)?`, 'gi');
        result = result.replace(regex, (_match, _labelPart, colon) => {
            return `**${displayName}${colon || ''}**`;
        });
    });

    return { text: result, modelNames: Array.from(modelNames) };
}


export default function Stage2({ rankings, labelToModel, labelToInstanceKey, aggregateRankings, startTime, endTime, characterNames = {}, councilModels = [], isLoading = false }) {
    const [activeRanking, setActiveRanking] = useState(null);
    const firstRankingRef = useRef(null);
    const displayNames = useMemo(() => buildDisplayNames(councilModels, characterNames), [councilModels, characterNames]);

    // Sort rankings by councilModels order to ensure consistent tab ordering.
    // Returns null if rankings is null (during loading state).
    const sortedRankings = rankings
        ? (councilModels.length > 0
            ? [...rankings].sort((a, b) => {
                const indexA = a?.member_index ?? councilModels.indexOf(a?.model);
                const indexB = b?.member_index ?? councilModels.indexOf(b?.model);
                // Models not in councilModels go to the end
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            })
            : rankings)
        : null;

    // Latch to first displayed ranking (once)
    if (firstRankingRef.current === null && sortedRankings?.length > 0) {
        firstRankingRef.current = sortedRankings[0];
    }

    // Determine which ranking to show: user's click > first arrived
    const displayRanking = activeRanking ?? firstRankingRef.current;

    // Find its current sorted position (by object ref, with model ID fallback for post-_complete)
    const safeIndex = (() => {
        if (!displayRanking || !sortedRankings) return 0;
        const byRef = sortedRankings.findIndex(r => r === displayRanking);
        if (byRef >= 0) return byRef;
        const byModel = sortedRankings.findIndex(r => r?.model === displayRanking?.model);
        return byModel >= 0 ? byModel : 0;
    })();

    const currentRanking = sortedRankings?.[safeIndex] || {};
    const hasError = currentRanking?.error || false;

    // Get visuals for current tab
    const currentVisuals = getModelVisuals(currentRanking?.model);

    return (
        <div className="stage-container stage-2">
            {/* Inline spinner — shows during loading, no DOM swap when rankings arrive */}
            {isLoading && (
                <div className="stage-loading">
                    <div className="spinner"></div>
                    <span>Running Peer Rankings...</span>
                </div>
            )}

            {/* Stage header always mounted — paddingTop adjusts like Stage4 */}
            <div className="stage-header" style={{ paddingTop: isLoading ? '10px' : '32px', paddingBottom: '16px' }}>
                <div className="stage-title" style={{ display: 'flex', alignItems: 'center', fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', gap: '8px' }}>
                    <span className="stage-icon">🏅</span>
                    Stage 2: Peer Rankings
                </div>
                <StageTimer startTime={startTime} endTime={endTime} label="Duration" />
            </div>

            {/* Tabs and content only render when data exists */}
            {sortedRankings && sortedRankings.length > 0 && (
            <>
            <h4 style={{ marginTop: '0', marginBottom: '0' }}>Raw Evaluations</h4>
            <p className="stage-description">
                Each model evaluated all responses (anonymized as Response A, B, C, etc.) and provided rankings.
                Below, model names are shown in <strong>bold</strong> for readability, but the original evaluation used anonymous labels.
            </p>

            {/* Avatar Tabs */}
            <div className="tabs" style={{ marginTop: '24px' }}>
                {sortedRankings.map((rank, index) => {
                    const shortName = getShortModelName(rank?.model);
                    const characterName = characterNames?.[rank?.member_index ?? index];

                    return (
                        <button
                            key={index}
                            className={`tab ${safeIndex === index ? 'active' : ''} ${rank?.error ? 'tab-error' : ''}`}
                            onClick={() => setActiveRanking(rank)}
                            style={safeIndex === index ? { borderColor: 'rgba(251, 146, 60, 0.5)' } : {}}
                            title={rank?.model}
                        >
                            <span className="tab-name">{displayNames[rank?.member_index ?? index] || shortName}</span>
                            {rank?.error && <span className="error-badge">!</span>}
                        </button>
                    );
                })}
            </div>

            <div className="tab-content glass-panel">
                <div className="model-header">
                    <div className="model-identity">
                        <div className="model-info">
                            <span className="model-name-large">{getShortModelName(currentRanking.model) || 'Unknown Model'}</span>
                        </div>
                    </div>

                    {hasError ? (
                        <span className="model-status error">Failed</span>
                    ) : (
                        <span className="model-status success">Completed</span>
                    )}
                    {!hasError && <CopyButton content={currentRanking?.ranking} />}
                </div>

                {hasError ? (
                    <div className="response-error">
                        <div className="error-icon">⚠️</div>
                        <div className="error-details">
                            <div className="error-title">Model Failed to Respond</div>
                            <div className="error-message">{currentRanking?.error_message || 'Unknown error'}</div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="ranking-content markdown-content">
                            {(() => {
                                const ranking = currentRanking?.ranking;
                                const rankingText = typeof ranking === 'string' ? ranking : String(ranking || '');
                                const { text: processedText, modelNames } = deAnonymizeText(rankingText, labelToModel, labelToInstanceKey, characterNames, councilModels, displayNames);

                                // Custom strong renderer that highlights model names
                                const components = {
                                    strong: ({ children }) => {
                                        const content = String(children);
                                        if (modelNames.includes(content)) {
                                            return <strong className="model-name-highlight">{children}</strong>;
                                        }
                                        return <strong>{children}</strong>;
                                    }
                                };

                                return (
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                                        {processedText}
                                    </ReactMarkdown>
                                );
                            })()}
                        </div>

                        {!isLoading && currentRanking?.parsed_ranking &&
                            currentRanking.parsed_ranking.length > 0 && (
                                <div className="parsed-ranking">
                                    <strong>Final Ranking:</strong>
                                    <ol>
                                        {currentRanking.parsed_ranking.map((label, i) => {
                                            const model = labelToModel?.[label];
                                            if (!model) return <li key={i}>{label}</li>;

                                            // Use instance key for accurate index lookup (handles duplicate models)
                                            const instanceKey = labelToInstanceKey?.[label];
                                            let instanceIndex = -1;
                                            if (instanceKey) {
                                                const indexMatch = instanceKey.match(/:(\d+)$/);
                                                if (indexMatch) instanceIndex = parseInt(indexMatch[1]);
                                            }
                                            // Fallback to findIndex for backward compatibility
                                            if (instanceIndex < 0) {
                                                instanceIndex = councilModels.findIndex(m => m === model);
                                            }

                                            const characterName = instanceIndex >= 0 ? characterNames?.[instanceIndex] : null;
                                            const displayName = (instanceIndex >= 0 && displayNames?.[instanceIndex]) || characterName || getShortModelName(model);

                                            return <li key={i}>{displayName}</li>;
                                        })}
                                    </ol>
                                </div>
                            )}
                    </>
                )}
            </div>
            </>
            )}

            {!isLoading && aggregateRankings && aggregateRankings.length > 0 && (
                <div className="aggregate-rankings">
                    <h4>Rankings Leaderboard</h4>
                    <p className="stage-description">
                        Combined results across all peer evaluations.
                    </p>
                    <div className="aggregate-list">
                        {aggregateRankings.map((agg, index) => {
                            const shortName = getShortModelName(agg.model);

                            // Use instance_key for accurate index lookup (handles duplicate models)
                            const instanceKey = agg.instance_key;
                            let instanceIndex = -1;
                            if (instanceKey) {
                                const indexMatch = instanceKey.match(/:(\d+)$/);
                                if (indexMatch) instanceIndex = parseInt(indexMatch[1]);
                            }
                            // Fallback to findIndex for backward compatibility
                            if (instanceIndex < 0) {
                                instanceIndex = councilModels.findIndex(m => m === agg.model);
                            }
                            const characterName = instanceIndex >= 0 ? characterNames?.[instanceIndex] : null;

                            return (
                                <div key={index} className={`aggregate-item${index === 0 ? ' aggregate-item--first' : ''}`}>
                                    <span className="rank-position">#{index + 1}</span>
                                    <span className="rank-model-name">{(instanceIndex >= 0 && displayNames?.[instanceIndex]) || characterName || shortName}</span>
                                    <span className="rank-score">{agg.average_rank.toFixed(2)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
