import { useState, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import StageTimer from './StageTimer';
import DebateGateway from './DebateGateway';
import { buildDisplayNames } from '../utils/modelHelpers';
import './Stage4.css';

// Tabs that appear progressively as sub-results arrive.
// Each tab is included only when its data key is present in stage4Data.
// Truth Check tab is excluded when truth_check is null or has no claims.
function buildTabs(stage4Data) {
  if (!stage4Data) {
    console.log('[DEBUG] buildTabs: no stage4Data');
    return [];
  }
  const tabs = [];
  const { truth_check, rankings, highlights } = stage4Data;

  console.log('[DEBUG] buildTabs truth_check:', {
    exists: !!truth_check,
    hasClaims: !!(truth_check?.claims),
    claimsLength: truth_check?.claims?.length || 0,
    checked: truth_check?.checked
  });

  // Show truth_check tab if truth_check was run (checked=true), had an error, or has a reason (e.g., "no_checkable_claims")
  if (truth_check && (truth_check.checked || truth_check.error || truth_check.reason)) {
    tabs.push({ id: 'truth', label: 'Truth Check' });
  }
  if (highlights && (highlights.agreements || highlights.disagreements || highlights.unique_insights)) {
    tabs.push({ id: 'highlights', label: 'Highlights' });
  }
  if (rankings && rankings.rankings) {
    tabs.push({ id: 'rankings', label: 'Rankings' });
  }
  // Show debates tab when gateway_issues are present (even if empty — shows consensus message)
  if (stage4Data.gateway_issues !== undefined) {
    tabs.push({ id: 'debates', label: 'Debates' });
  }
  return tabs;
}

// Extract short model name from model ID, handling provider prefixes and version tags
// Examples:
//   'ollama:llama3.1:latest' -> 'llama3.1'
//   'openai:gpt-4.1' -> 'gpt-4.1'
//   'anthropic/claude-sonnet-4' -> 'claude-sonnet-4'
//   'groq:llama3-70b-8192' -> 'llama3-70b-8192'
function extractShortModelName(modelId) {
  if (!modelId) return 'Unknown';

  // Handle slash-separated (e.g., 'anthropic/claude-sonnet-4')
  if (modelId.includes('/')) {
    return modelId.split('/').pop();
  }

  // Handle colon-separated (e.g., 'ollama:llama3.1:latest' or 'openai:gpt-4.1')
  if (modelId.includes(':')) {
    const parts = modelId.split(':');
    // If 3+ parts (provider:model:version), take the model part (index 1)
    // If 2 parts (provider:model), take the model part (index 1)
    // The model name is always after the provider prefix
    if (parts.length >= 2) {
      return parts[1];
    }
    return parts.pop();
  }

  return modelId;
}

// Safely render markdown content, handling non-string values
function MarkdownContent({ children, className }) {
  const content = typeof children === 'string' ? children : String(children || '');
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

// Reverse lookup: given a model ID, find its character name + short model name.
function getDisplayName(modelId, labelToModel, characterNames, memberIndex, displayNames) {
  if (!modelId) return 'Unknown';

  // Priority 1: Precomputed displayNames (handles char names AND duplicate disambiguation)
  if (memberIndex !== undefined && memberIndex !== null && displayNames) {
    const dn = displayNames[memberIndex];
    if (dn) return dn;
  }

  // Priority 2: Direct character name by member_index
  if (memberIndex !== undefined && memberIndex !== null && characterNames) {
    const characterName = characterNames[memberIndex];
    if (characterName) return characterName;
  }

  // Reverse-lookup fallback for backward compatibility
  const entry = Object.entries(labelToModel || {}).find(([, v]) => v === modelId);
  if (entry) {
    const [label] = entry;
    const letter = label.split(' ').pop();
    const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(letter);
    const characterName = idx >= 0 && characterNames ? characterNames[idx] : null;
    const shortModel = extractShortModelName(modelId);
    if (characterName) return characterName;
    return shortModel;
  }

  return extractShortModelName(modelId);
}

export default function Stage4({
  stage4Data,
  stage4Status,
  startTime,
  endTime,
  labelToModel,
  characterNames,
  councilModels,
  onRunDebate,
  debateGatewayActive,
  debatePending,
  onProceedToSynthesis,
}) {
  // latchedTabRef holds the first tab id that ever appeared.
  // It is set once and never changed — this prevents auto-advancing.
  // Users can still click any tab to switch manually (activeTabId state).
  const latchedTabRef = useRef(null);
  const [activeTabId, setActiveTabId] = useState(null);
  const displayNames = useMemo(() => buildDisplayNames(councilModels, characterNames), [councilModels, characterNames]);

  const tabs = buildTabs(stage4Data);

  // Latch to the first tab seen — set during render so effectiveTabId is correct immediately
  if (latchedTabRef.current === null && tabs.length > 0) {
    latchedTabRef.current = tabs[0].id;
  }

  // The displayed active tab: user's explicit click > latched first tab > null
  const effectiveTabId = activeTabId && tabs.find(t => t.id === activeTabId)
    ? activeTabId
    : latchedTabRef.current && tabs.find(t => t.id === latchedTabRef.current)
    ? latchedTabRef.current
    : null;

  const isLoading = stage4Status === 'loading';

  const allDebatesCompleted =
    Array.isArray(stage4Data?.gateway_issues) &&
    stage4Data.gateway_issues.length > 0 &&
    Array.isArray(stage4Data?.debates) &&
    stage4Data.debates.length === stage4Data.gateway_issues.length &&
    stage4Data.debates.every(d => d.status === 'completed');

  return (
    <div className="stage-container stage-4">
      {isLoading && (
        <div className="stage-loading">
          <div className="spinner"></div>
          <span>Running Council Analysis...</span>
        </div>
      )}
      <div className="stage-header" style={{ paddingTop: isLoading ? '10px' : '24px', paddingBottom: '16px' }}>
        <div className="stage-title" style={{ display: 'flex', alignItems: 'center', fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', gap: '8px' }}>
          ⚖️ Stage 4: Council Analysis
        </div>
        <StageTimer startTime={startTime} endTime={endTime} label="Duration" />
      </div>
      <p className="stage-subtitle">Compound analysis of the deliberation.</p>

      {tabs.length > 0 && (
        <>
          <div className="stage4-tab-bar">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`stage4-tab-btn${effectiveTabId === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            {isLoading && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: '4px' }}>
                Loading...
              </span>
            )}
            {/* Show "Loading..." when rankings exist but debates tab hasn't appeared yet (live run only) */}
            {!isLoading && debatePending && stage4Data?.rankings?.rankings && stage4Data?.gateway_issues === undefined && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: '4px' }}>
                Loading...
              </span>
            )}
          </div>

          <div className="stage4-tab-content glass-panel">
            {['truth', 'highlights', 'rankings'].includes(effectiveTabId) && (!isLoading || effectiveTabId === 'truth') && (
              <div className="stage4-section-header">
                <span className="stage4-section-label">
                  {effectiveTabId === 'rankings' ? "Chairman's Rankings" : effectiveTabId === 'highlights' ? "Council Highlights" : "Council Research"}
                </span>
                <span className="model-status success">Completed</span>
              </div>
            )}
            {effectiveTabId === 'truth' && (
              <TruthCheckTab data={stage4Data.truth_check} />
            )}
            {effectiveTabId === 'highlights' && (
              <HighlightsTab
                data={stage4Data.highlights}
                labelToModel={labelToModel}
                characterNames={characterNames}
                councilModels={councilModels}
                displayNames={displayNames}
              />
            )}
            {effectiveTabId === 'rankings' && (
              <RankingsTab
                data={stage4Data.rankings}
                labelToModel={labelToModel}
                characterNames={characterNames}
                councilModels={councilModels}
                displayNames={displayNames}
              />
            )}
            {effectiveTabId === 'debates' && (
              <>
              <div className="stage4-section-header">
                <span className="stage4-section-label">Member Debates</span>
                <span className="model-status success" style={{ visibility: allDebatesCompleted ? 'visible' : 'hidden' }}>Completed</span>
              </div>
              <div style={{ padding: '8px 0' }}>
                <DebateGateway
                  issues={stage4Data.gateway_issues || []}
                  debates={stage4Data.debates || []}
                  onRunDebate={onRunDebate}
                  labelToModel={labelToModel}
                  characterNames={characterNames}
                />
              </div>
              </>
            )}
          </div>
          {debateGatewayActive && stage4Data && !isLoading && (
            <div style={{ marginTop: '12px' }}>
              <button
                className="proceed-button"
                style={{ padding: '6px 16px', fontSize: '13px' }}
                onClick={onProceedToSynthesis}
              >
                Proceed to Chairman Synthesis
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Sub-components (Plans 02 and 03 replace placeholders) ---

function TruthCheckTab({ data }) {
  if (!data) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>No truth check data available.</div>;
  }

  if (data.error) {
    return (
      <div style={{ color: '#ef4444', fontSize: '14px', padding: '16px' }}>
        Truth check failed: {data.error}
      </div>
    );
  }

  const claims = data.claims || [];
  if (claims.length === 0) {
    const message = data.reason === 'no_checkable_claims'
      ? 'No checkable factual claims were found in the responses.'
      : data.reason || 'No factual claims identified.';
    return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>{message}</div>;
  }

  const verdictClass = (verdict) => {
    if (verdict === 'Confirmed') return 'verdict-badge verdict-confirmed';
    if (verdict === 'Disputed') return 'verdict-badge verdict-disputed';
    return 'verdict-badge verdict-unverified';
  };

  // Map legacy "Unaddressed" to "Unverified" for display
  const displayVerdict = (verdict) => {
    if (verdict === 'Unaddressed') return 'Unverified';
    return verdict;
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <table className="truth-check-table">
        <thead>
          <tr>
            <th className="verdict-column">Verdict</th>
            <th className="claim-column">Claim</th>
            <th className="reason-column">Reason</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim, idx) => (
            <tr key={idx}>
              <td className="verdict-column">
                <span className={verdictClass(claim.verdict)}>{displayVerdict(claim.verdict)}</span>
              </td>
              <td className="claim-column">
                <MarkdownContent className="claim-text">{claim.text}</MarkdownContent>
                {claim.source_url && (
                  <a
                    href={claim.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="claim-source"
                  >
                    {claim.source_url}
                  </a>
                )}
              </td>
              <td className="reason-column">
                <MarkdownContent className="claim-reason">{claim.reason}</MarkdownContent>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingsTab({ data, labelToModel, characterNames, councilModels, displayNames }) {
  if (!data) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>No rankings data available.</div>;
  }

  if (data.error) {
    return (
      <div style={{ color: '#ef4444', fontSize: '14px', padding: '16px' }}>
        Rankings failed: {data.error}
      </div>
    );
  }

  const rankings = data.rankings || [];
  if (rankings.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>No rankings available.</div>;
  }

  // Sort by rank ascending so rank 1 always appears at the top regardless of
  // the order in which the backend emits entries (normalize_scores sorts by
  // score desc, so the array order may not match the rank field).
  const sortedRankings = [...rankings].sort((a, b) => a.rank - b.rank);

  // Dimensions are objects { label: "Strong"|"Moderate"|"Weak", score: 0-100 }
  const dims = [
    { key: 'reasoning', label: 'Reasoning' },
    { key: 'insight', label: 'Insight' },
    { key: 'clarity', label: 'Clarity' },
  ];

  return (
    <div style={{ padding: '8px 0' }}>
      {sortedRankings.map((entry) => {
        const displayName = getDisplayName(entry.model, labelToModel, characterNames, entry.member_index, displayNames);
        const isFirst = entry.rank === 1;
        return (
          <div key={entry.member_index ?? entry.rank} className="ranking-row">
            <span className={`rank-number${isFirst ? ' rank-1' : ''}`}>
              {entry.rank}
            </span>
            <div className={`ranking-model-name${isFirst ? ' rank-1' : ''}`}>{displayName}</div>
            {dims.map(dim => {
              const score = entry.dimensions?.[dim.key]?.score;
              const displayScore = score !== undefined && score !== null ? Math.round(score) : '--';
              return (
                <div key={dim.key} className="ranking-dim">
                  <span className="ranking-dim-label">{dim.label}</span>
                  <span className="ranking-dim-score">{displayScore}</span>
                </div>
              );
            })}
            <div className="ranking-total">
              <span className="ranking-dim-label">Total</span>
              <span className={`ranking-score-total${isFirst ? ' rank-1' : ''}`}>{Math.round(entry.normalized_score)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HighlightsTab({ data, labelToModel, characterNames, councilModels, displayNames }) {
  if (!data) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>No highlights data available.</div>;
  }

  if (data.error) {
    return (
      <div style={{ color: '#ef4444', fontSize: '14px', padding: '16px' }}>
        Highlights failed: {data.error}
      </div>
    );
  }

  const agreements = data.agreements || [];
  const disagreements = data.disagreements || [];
  const uniqueInsights = data.unique_insights || [];

  const hasAny = agreements.length > 0 || disagreements.length > 0 || uniqueInsights.length > 0;
  if (!hasAny) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>No highlights extracted.</div>;
  }

  // Format a list of model IDs as display names joined by comma
  const formatModels = (models, memberIndices) => {
    if (!models || models.length === 0) return '';
    return models.map((m, i) => {
      const mi = memberIndices?.[i];
      return getDisplayName(m, labelToModel, characterNames, mi, displayNames);
    }).join(', ');
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {agreements.length > 0 && (
        <div className="highlights-section">
          <div className="highlights-section-title">Points of Agreement</div>
          {agreements.map((item, idx) => (
            <div key={idx} className="highlight-item-row">
              <span className="highlight-check">✅</span>
              <div className="highlight-content">
                <MarkdownContent className="highlight-text">{item.finding}</MarkdownContent>
              </div>
              {item.models && item.models.filter(Boolean).length > 0 && (
                <div className="highlight-models-right">{formatModels(item.models.filter(Boolean), item.member_indices)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {disagreements.length > 0 && (
        <div className="highlights-section">
          <div className="highlights-section-title">Points of Disagreement</div>
          {disagreements.map((item, idx) => {
            const validPositions = (item.positions || []).filter(p => p && p.model_id);
            const positionModels = validPositions.map(p => p.model_id);
            const positionIndices = validPositions.map(p => p.member_index);
            return (
              <div key={idx} className="highlight-item-row">
                <span className="highlight-x">❌</span>
                <div className="highlight-content">
                  <MarkdownContent className="highlight-text">{item.topic || item.finding}</MarkdownContent>
                  {item.why_they_differ && (
                    <MarkdownContent className="highlight-sub">{item.why_they_differ}</MarkdownContent>
                  )}
                </div>
                {positionModels.length > 0 && (
                  <div className="highlight-models-right">{formatModels(positionModels, positionIndices)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {uniqueInsights.length > 0 && (
        <div className="highlights-section">
          <div className="highlights-section-title">Unique Insights</div>
          <div className="unique-insights-header">
            <span>Finding</span>
            <span>Source</span>
            <span>Why It Matters</span>
          </div>
          {uniqueInsights.map((item, idx) => (
            <div key={idx} className="unique-insight-row">
              <div className="unique-insight-finding">
                <span className="unique-insight-emoji">🔍</span>
                <span className="inline-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.finding}</ReactMarkdown>
                </span>
              </div>
              <div className="unique-insight-model">
                {item.model
                  ? getDisplayName(item.model, labelToModel, characterNames, item.member_index, displayNames)
                  : ''}
              </div>
              <MarkdownContent className="unique-insight-why">{item.why_it_matters}</MarkdownContent>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

