import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getShortModelName, getNameVariants, escapeRegex, normalizeDashes } from '../utils/modelHelpers';
import './DebateGateway.css';

/**
 * Resolve the display name for a debate participant at render time.
 *
 * Priority:
 * 1. Backend-provided name (already correctly resolved by _resolve_participant_name)
 * 2. Character name from characterNames (looked up via labelToModel index)
 * 3. getShortModelName(model_id)
 */
function resolveDebateSpeakerName(modelId, rawName, labelToModel, characterNames) {
  // First priority: use the backend-provided name (it's already correctly resolved
  // per slot, handling duplicate models properly)
  if (rawName) return rawName;

  // Fallback: try to resolve via labelToModel (only reliable for unique models)
  if (modelId && labelToModel) {
    const entry = Object.entries(labelToModel).find(([, v]) => v === modelId);
    if (entry) {
      const [label] = entry;
      const letter = label.split(' ').pop();
      const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(letter);
      const characterName = idx >= 0 && characterNames ? characterNames[idx] : null;
      if (characterName) return characterName;
    }
  }
  if (modelId) return getShortModelName(modelId);
  return 'Unknown';
}

// normalizeDashes and escapeRegex imported from modelHelpers

/**
 * Build the resolved display names for all debate participants.
 * Returns an array of { storedName, resolvedName, role } objects.
 */
function buildParticipantNameMap(participants, labelToModel, characterNames) {
  if (!participants) return [];
  return participants.map(p => ({
    storedName: p.name,
    resolvedName: resolveDebateSpeakerName(p.model_id, p.name, labelToModel, characterNames),
    role: p.role,
  }));
}

/**
 * Replace stored participant short names in a text string with resolved display
 * names. Also strips leftover role labels like "(primary_a)", "(primary_b)",
 * "(commentator_1)" that LLMs echo from the prompt format.
 *
 * Applied to: accordion title, verdict text, turn body text.
 */
function resolveNamesInText(text, nameMap) {
  if (!text || !nameMap || nameMap.length === 0) return text;
  let result = normalizeDashes(text);

  // Replace stored names with resolved names
  for (const { storedName, resolvedName } of nameMap) {
    if (!storedName || resolvedName === storedName) continue;
    result = result.replace(
      new RegExp(`\\b${escapeRegex(storedName)}\\b`, 'g'),
      resolvedName
    );
  }

  // Replace bare role labels with resolved names (e.g., "primary_b" → "gemma3")
  // Handles cases where the LLM writes bare role labels (including inside bold markdown)
  // Case-insensitive to match "Primary_b" at sentence start (LLMs naturally capitalize)
  for (const { resolvedName, role } of nameMap) {
    if (!role || !resolvedName) continue;
    result = result.replace(
      new RegExp(`\\b${escapeRegex(role)}\\b`, 'gi'),
      resolvedName
    );
  }

  // Strip role-like labels LLMs echo from the prompt format after participant names.
  // Covers real roles (primary_a, commentator_1) AND invented ones (secondary_b, debater_a).
  // Pattern: "Name (role_label)" → "Name" where role_label is word chars with underscores/digits.
  for (const { resolvedName } of nameMap) {
    if (!resolvedName) continue;
    const esc = escapeRegex(resolvedName);
    // Match: Name (any_role_label) — with optional bold wrapping and trailing colon
    result = result.replace(
      new RegExp(`(\\*{0,2}${esc}\\*{0,2})\\s*\\([a-z][a-z0-9_]*\\):?`, 'gi'),
      '$1'
    );
  }
  // Fallback: strip any remaining bare role labels not adjacent to a name
  result = result.replace(/\s*\(primary_[ab]\)/gi, '');
  result = result.replace(/\s*\(commentator_\d+\)/gi, '');

  // Collapse "Name (Name)" duplicates created when role→name replacement turns
  // "gpt-oss (primary_b)" into "gpt-oss (gpt-oss)".
  // Handles: Name (Name), **Name** (Name), **Name (Name)**, [Name](Name)
  for (const { resolvedName } of nameMap) {
    if (!resolvedName) continue;
    const esc = escapeRegex(resolvedName);
    // Bold/plain parenthetical: **Name** (Name)** or Name (Name)
    result = result.replace(
      new RegExp(`\\*{0,2}${esc}\\*{0,2}\\s*\\(\\*{0,2}${esc}\\*{0,2}\\)\\*{0,2}`, 'gi'),
      resolvedName
    );
    // Markdown link: [Name](Name)
    result = result.replace(
      new RegExp(`\\[${esc}\\]\\(${esc}\\)`, 'gi'),
      resolvedName
    );
  }

  // Collapse "Part (FullName)" where Part is one word of a multi-word name
  // e.g. "Graeber (David Graeber)" → "David Graeber"
  for (const { resolvedName } of nameMap) {
    if (!resolvedName) continue;
    const words = resolvedName.split(/\s+/);
    if (words.length < 2) continue;
    const escFull = escapeRegex(resolvedName);
    for (const word of words) {
      if (word.length < 3) continue;
      const escPart = escapeRegex(word);
      result = result.replace(
        new RegExp(`\\*{0,2}${escPart}\\*{0,2}\\s*\\(\\*{0,2}${escFull}\\*{0,2}\\)\\*{0,2}`, 'gi'),
        resolvedName
      );
    }
  }

  return result;
}

/**
 * Build custom ReactMarkdown component renderers that scan text nodes for
 * participant names and wrap matches in <span className="model-name-highlight">.
 * This works at render time, avoiding markdown-level text manipulation that
 * breaks when LLM output already contains bold/italic formatting.
 */
function makeHighlightComponents(nameSet) {
    const sortedNames = [...nameSet]
        .filter(n => n.length > 0)
        .sort((a, b) => b.length - a.length);
    const nameRegex = sortedNames.length > 0
        ? new RegExp(`(?<![\\w])(${sortedNames.map(n => escapeRegex(n)).join('|')})(?![\\w])`, 'gi')
        : null;

    function highlightTextNode(text) {
        if (!nameRegex || typeof text !== 'string') return text;
        const parts = [];
        let lastIndex = 0;
        nameRegex.lastIndex = 0;
        let match;
        while ((match = nameRegex.exec(text)) !== null) {
            if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
            parts.push(<span key={`hl-${match.index}`} className="model-name-highlight">{match[0]}</span>);
            lastIndex = nameRegex.lastIndex;
        }
        if (parts.length === 0) return text;
        if (lastIndex < text.length) parts.push(text.slice(lastIndex));
        return parts;
    }

    function processChildren(children) {
        if (!nameRegex) return children;
        if (typeof children === 'string') return highlightTextNode(children);
        if (!Array.isArray(children)) return children;
        return children.flatMap((child) => {
            if (typeof child === 'string') {
                const result = highlightTextNode(child);
                return Array.isArray(result) ? result : [result];
            }
            return [child];
        });
    }

    return {
        strong: ({ children, ...props }) => <strong {...props}>{processChildren(children)}</strong>,
        em: ({ children, ...props }) => <em {...props}>{processChildren(children)}</em>,
        p: ({ children, ...props }) => <p {...props}>{processChildren(children)}</p>,
        li: ({ children, ...props }) => <li {...props}>{processChildren(children)}</li>,
        td: ({ children, ...props }) => <td {...props}>{processChildren(children)}</td>,
        th: ({ children, ...props }) => <th {...props}>{processChildren(children)}</th>,
        blockquote: ({ children, ...props }) => <blockquote {...props}>{processChildren(children)}</blockquote>,
    };
}

// Internal sub-component: shows spinner while debate is running
function ProgressDots({ debate }) {
  const isRunning = debate?.status === 'running';

  return (
    <span className="debate-progress-dots">
      {isRunning && <span className="debate-spinner" />}
      <span className="debate-phase-text">Debating...</span>
    </span>
  );
}

// Internal sub-component: one accordion item per debate issue
function DebateIssueAccordion({ issue, debate, onRun, labelToModel, characterNames }) {
  const [expanded, setExpanded] = useState(false);

  const status = debate?.status || 'pending';
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed' || status === 'timeout';

  // Build name map once for this accordion — uses issue.participants for title/header,
  // and debate.participants for turn texts/verdict (same data, debate may have more turns).
  const issueNameMap = buildParticipantNameMap(issue.participants, labelToModel, characterNames);
  const debateNameMap = buildParticipantNameMap(debate?.participants, labelToModel, characterNames);

  // Build nameSet for the ReactMarkdown highlight renderer, including variants
  const allResolvedNames = [...issueNameMap, ...debateNameMap]
    .map(e => e.resolvedName).filter(Boolean);
  const nameSet = new Set();
  for (const v of getNameVariants(allResolvedNames)) {
    nameSet.add(v.toLowerCase());
  }
  const highlightComponents = makeHighlightComponents(nameSet);

  const handleHeaderClick = () => {
    if (status === 'pending') {
      // First click on pending issue: expand and trigger debate
      setExpanded(true);
      onRun();
    } else {
      // Toggle expand/collapse for all other states
      setExpanded(!expanded);
    }
  };

  return (
    <div className="debate-accordion">
      <div
        className={`debate-accordion-header ${status}`}
        onClick={handleHeaderClick}
      >
        <span className="debate-accordion-arrow">
          {isCompleted && !expanded ? '✓' : (expanded ? '▼' : '▶')}
        </span>
        <span className="debate-accordion-title">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightComponents}>
            {resolveNamesInText(issue.title, issueNameMap)}
          </ReactMarkdown>
        </span>
        {isRunning && <ProgressDots debate={debate} />}
        {isFailed && (
          <span className="debate-status-text">
            ({status === 'timeout' ? 'timed out' : 'failed'})
          </span>
        )}
      </div>

      {expanded && (
        <div className="debate-accordion-body">
          {(debate?.transcript || []).map((turn, idx) => (
            <div key={idx} className="debate-turn">
              <div className="debate-turn-speaker">
                {resolveDebateSpeakerName(turn.model_id, turn.name, labelToModel, characterNames)}
              </div>
              <blockquote className="debate-turn-text">
                {(() => {
                  // Safely convert turn.text to string for display
                  const text = turn.text;
                  let displayText;
                  if (typeof text === 'string') {
                    displayText = text;
                  } else if (Array.isArray(text)) {
                    displayText = text.map(t => typeof t === 'object' ? JSON.stringify(t) : String(t)).join(' ');
                  } else if (typeof text === 'object' && text !== null) {
                    displayText = JSON.stringify(text);
                  } else {
                    displayText = String(text || '');
                  }
                  return (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightComponents}>
                      {resolveNamesInText(displayText, debateNameMap)}
                    </ReactMarkdown>
                  );
                })()}
              </blockquote>
            </div>
          ))}

          {isCompleted && debate?.verdict && (
            <div className="debate-verdict-section">
              <div className="debate-verdict-label">Verdict</div>
              <div className="debate-verdict-summary">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightComponents}>
                  {resolveNamesInText(debate.verdict.summary || '', debateNameMap)}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {isFailed && (!debate?.transcript || debate.transcript.length === 0) && (
            <div className="debate-empty-text">No transcript available.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Main exported component: renders Debates tab content inside Stage 4
export default function DebateGateway({ issues, debates, onRunDebate, labelToModel, characterNames }) {
  // Consensus case: no issues means all models agreed
  if (!issues || issues.length === 0) {
    return (
      <div className="debate-consensus">
        Council reached consensus — no debates needed.
      </div>
    );
  }

  return (
    <div className="debate-gateway">
      {issues.map((issue) => {
        const debate = (debates || []).find(d => d.idx === issue.idx);
        return (
          <DebateIssueAccordion
            key={issue.idx}
            issue={issue}
            debate={debate}
            onRun={() => onRunDebate(issue.idx)}
            labelToModel={labelToModel}
            characterNames={characterNames}
          />
        );
      })}
    </div>
  );
}
