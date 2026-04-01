import { useState, useEffect, useRef, useMemo } from 'react';
import { getModelVisuals, getShortModelName, buildDisplayNames, stripFootnoteMarkers } from '../utils/modelHelpers';
import ThinkBlockRenderer from './ThinkBlockRenderer';
import CopyButton from './CopyButton';
import StageTimer from './StageTimer';
import './Stage3.css';
import './CopyButton.css';

export default function Stage3({ responses, startTime, endTime, characterNames = {}, councilModels = [] }) {
  const [activeResponse, setActiveResponse] = useState(null);
  const firstResponseRef = useRef(null);
  const displayNames = useMemo(() => buildDisplayNames(councilModels, characterNames), [councilModels, characterNames]);

  // Sort responses by member_index (slot position) to ensure consistent tab ordering,
  // even when multiple slots use the same model ID
  const sortedResponses = [...responses].sort((a, b) => {
    const indexA = a?.member_index ?? councilModels.indexOf(a?.model);
    const indexB = b?.member_index ?? councilModels.indexOf(b?.model);
    return indexA - indexB;
  });

  if (!sortedResponses || sortedResponses.length === 0) {
    return null;
  }

  // Latch to first displayed response (once)
  if (firstResponseRef.current === null && sortedResponses.length > 0) {
    firstResponseRef.current = sortedResponses[0];
  }

  // Determine which response to show: user's click > first arrived
  const displayResponse = activeResponse ?? firstResponseRef.current;

  // Find its current sorted position (by object ref, with member_index fallback for post-_complete)
  const safeIndex = (() => {
    if (!displayResponse) return 0;
    const byRef = sortedResponses.findIndex(r => r === displayResponse);
    if (byRef >= 0) return byRef;
    // Use member_index for reliable matching when models are duplicated
    if (displayResponse?.member_index != null) {
      const byIdx = sortedResponses.findIndex(r => r?.member_index === displayResponse.member_index);
      if (byIdx >= 0) return byIdx;
    }
    const byModel = sortedResponses.findIndex(r => r?.model === displayResponse?.model);
    return byModel >= 0 ? byModel : 0;
  })();

  const currentResponse = sortedResponses[safeIndex] || {};
  const hasError = currentResponse?.error || false;

  const gridColumns = Math.min(sortedResponses.length, 4);

  // Get visuals for current tab
  const currentVisuals = getModelVisuals(currentResponse?.model);

  return (
    <div className="stage-container stage-3">
      <div className="stage-header" style={{ paddingTop: '10px', paddingBottom: '16px' }}>
        <div className="stage-title" style={{ display: 'flex', alignItems: 'center', fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', gap: '8px' }}>
          <span className="stage-icon">🔄</span>
          Stage 3: Revisions
        </div>
        <StageTimer startTime={startTime} endTime={endTime} label="Duration" />
      </div>
      <p className="stage-subtitle">Ammended based on peer feedback.</p>

      {/* Avatar Tabs */}
      <div
        className="tabs"
        style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}
      >
        {sortedResponses.map((resp, index) => {
          const shortName = getShortModelName(resp?.model);
          const characterName = characterNames?.[resp?.member_index ?? index];

          return (
            <button
              key={index}
              className={`tab ${safeIndex === index ? 'active' : ''} ${resp?.error ? 'tab-error' : ''}`}
              onClick={() => setActiveResponse(resp)}
              style={safeIndex === index ? { borderColor: 'rgba(16, 185, 129, 0.5)' } : {}}
              title={resp?.model}
            >
              <span className="tab-name">{displayNames[resp?.member_index ?? index] || shortName}</span>
              {resp?.error && <span className="error-badge">!</span>}
            </button>
          );
        })}
      </div>

      <div className="tab-content glass-panel">
        <div className="model-header">
          <div className="model-identity">
            <div className="model-info">
              <span className="model-name-large">{getShortModelName(currentResponse.model) || 'Unknown Model'}</span>
            </div>
          </div>

          {hasError ? (
            <span className="model-status error">Failed</span>
          ) : (
            <span className="model-status success">Completed</span>
          )}
          {!hasError && <CopyButton content={currentResponse.response} />}
        </div>

        {hasError ? (
          <div className="response-error">
            <div className="error-icon">⚠️</div>
            <div className="error-details">
              <div className="error-title">Model Failed to Respond</div>
              <div className="error-message">{currentResponse?.error_message || 'Unknown error'}</div>
            </div>
          </div>
        ) : (
          <div className="response-text markdown-content">
            <ThinkBlockRenderer
              content={
                stripFootnoteMarkers(
                  typeof currentResponse.response === 'string'
                    ? currentResponse.response
                    : String(currentResponse.response || 'No response'),
                  currentResponse.model
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
