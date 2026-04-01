import { useState } from 'react';
import { getModelVisuals, getShortModelName, buildDisplayNames, getNameVariants, escapeRegex } from '../utils/modelHelpers';
import ThinkBlockRenderer from './ThinkBlockRenderer';
import CopyButton from './CopyButton';
import StageTimer from './StageTimer';
import './Stage5.css';
import './CopyButton.css';

/**
 * Convert a technical short model name to a human-readable display name.
 * Mirrors the backend format_model_name logic.
 * @param {string} shortName - Short model name (after provider prefix stripped)
 * @returns {string} Human-readable name
 */
function formatModelDisplayName(shortName) {
    let name = shortName.replace(/[-:]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    name = name.replace(/\s+\d{4,}$/g, '');               // strip version hashes
    name = name.replace(/\s+\d+[bBmM]$/i, '');            // strip param counts (4b, 8b, 20b)
    return name;
}

/**
 * Builds the list of member names to highlight (no text manipulation).
 * Returns the original text unchanged plus a list of name strings for
 * render-time scanning.
 */
function collectMemberNames(text, councilModels = [], characterNames = {}) {
    if (!text || !councilModels || councilModels.length === 0) {
        return { text, memberNames: [] };
    }

    const memberNames = new Set();
    const displayNames = buildDisplayNames(councilModels, characterNames);

    councilModels.forEach((model, index) => {
        if (!model) return;
        const displayName = displayNames[index];
        if (!displayName) return;

        memberNames.add(displayName.toLowerCase());

        // Also add technical model name variants when no character name
        const characterName = characterNames?.[index];
        if (!characterName) {
            const technicalName = getShortModelName(model);
            memberNames.add(technicalName.toLowerCase());
            const cleanDisplayName = formatModelDisplayName(technicalName);
            if (cleanDisplayName.toLowerCase() !== technicalName.toLowerCase()) {
                memberNames.add(cleanDisplayName.toLowerCase());
            }
        }
    });

    // Expand with name-part variants (e.g., "Dennett" from "Daniel Dennett")
    const casedNames = councilModels.map((_, index) => displayNames[index]).filter(Boolean);
    const variants = getNameVariants(casedNames);
    for (const variant of variants) {
        memberNames.add(variant.toLowerCase());
    }

    return { text, memberNames: Array.from(memberNames) };
}

function CitationSection({ citations }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className={`citation-section ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="citation-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="citation-icon">📚</span>
        <span className="citation-label">Sources ({citations.length})</span>
        <span className="citation-chevron">{isExpanded ? '▼' : '▶'}</span>
      </button>
      {isExpanded && (
        <div className="citation-content">
          <ul className="citation-list">
            {citations.map((citation, index) => (
              <li key={index}>
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {citation.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Stage5({
    finalResponse,
    startTime,
    endTime,
    chairmanCharacterName = '',
    councilModels = [],
    characterNames = {},
    debateCount = null,
    isFollowUp = false
}) {
    if (!finalResponse) {
        return null;
    }

    const visuals = getModelVisuals(finalResponse?.model);
    const shortName = getShortModelName(finalResponse?.model);

    // Process content to highlight member names
    const rawContent = typeof finalResponse?.response === 'string'
        ? finalResponse.response
        : String(finalResponse?.response || 'No response');

    const { text: processedContent, memberNames } = collectMemberNames(
        rawContent,
        councilModels,
        characterNames
    );

    // Build compiled regex from member names (longest-first to prefer full names)
    const sortedNames = [...memberNames]
        .filter(n => n.length > 0)
        .sort((a, b) => b.length - a.length);
    const nameRegex = sortedNames.length > 0
        ? new RegExp(`(?<![\\w])(${sortedNames.map(n => escapeRegex(n)).join('|')})(?![\\w])`, 'gi')
        : null;

    // Identify name parts that are sub-words of multi-word member names
    // so we can suppress false positives like "George" in "George Washington"
    const fullNamesLower = new Set(
        memberNames.filter(n => n.includes(' '))
    );
    const namePartsSet = new Set();
    for (const fullName of fullNamesLower) {
        for (const part of fullName.split(/\s+/)) {
            if (part.length >= 3) namePartsSet.add(part.toLowerCase());
        }
    }

    // Check if a matched name part is embedded in a larger capitalized-word
    // phrase that isn't a known council member name (e.g., "George Washington")
    function isEmbeddedInUnknownName(text, matchStart, matchEnd) {
        let left = matchStart;
        // Expand left past adjacent capitalized words
        while (left > 0) {
            if (text[left - 1] !== ' ') break;
            let probe = left - 2;
            while (probe >= 0 && /[a-zA-Z]/.test(text[probe])) probe--;
            const wordStart = probe + 1;
            if (wordStart < left - 1 && /[A-Z]/.test(text[wordStart])) {
                left = wordStart;
            } else {
                break;
            }
        }
        // Expand right past adjacent capitalized words
        let right = matchEnd;
        while (right < text.length) {
            if (text[right] !== ' ') break;
            const wordStart = right + 1;
            if (wordStart >= text.length || !/[A-Z]/.test(text[wordStart])) break;
            let wordEnd = wordStart;
            while (wordEnd < text.length && /[a-zA-Z]/.test(text[wordEnd])) wordEnd++;
            right = wordEnd;
        }
        const phrase = text.slice(left, right).toLowerCase();
        // If phrase is longer than the match, it's embedded in a larger name
        if (phrase.length > matchEnd - matchStart) {
            return !fullNamesLower.has(phrase);
        }
        return false;
    }

    // Scan a text string for model names, return array of text + highlighted spans
    function highlightTextNode(text) {
        if (!nameRegex || typeof text !== 'string') return text;
        const parts = [];
        let lastIndex = 0;
        nameRegex.lastIndex = 0;
        let match;
        while ((match = nameRegex.exec(text)) !== null) {
            // Suppress name-part matches embedded in unknown names
            const matchedLower = match[0].toLowerCase();
            if (namePartsSet.has(matchedLower) &&
                isEmbeddedInUnknownName(text, match.index, match.index + match[0].length)) {
                continue;
            }
            if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
            parts.push(<span key={`hl-${match.index}`} className="model-name-highlight">{match[0]}</span>);
            lastIndex = nameRegex.lastIndex;
        }
        if (parts.length === 0) return text;
        if (lastIndex < text.length) parts.push(text.slice(lastIndex));
        return parts;
    }

    // Walk ReactMarkdown children: process strings, pass React elements unchanged
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

    // Highlight model names in ALL text nodes at render time — no markdown manipulation needed
    const markdownComponents = {
        strong: ({ children, ...props }) => <strong {...props}>{processChildren(children)}</strong>,
        em: ({ children, ...props }) => <em {...props}>{processChildren(children)}</em>,
        p: ({ children, ...props }) => <p {...props}>{processChildren(children)}</p>,
        li: ({ children, ...props }) => <li {...props}>{processChildren(children)}</li>,
        td: ({ children, ...props }) => <td {...props}>{processChildren(children)}</td>,
        th: ({ children, ...props }) => <th {...props}>{processChildren(children)}</th>,
        h1: ({ children, ...props }) => <h1 {...props}>{processChildren(children)}</h1>,
        h2: ({ children, ...props }) => <h2 {...props}>{processChildren(children)}</h2>,
        h3: ({ children, ...props }) => <h3 {...props}>{processChildren(children)}</h3>,
        h4: ({ children, ...props }) => <h4 {...props}>{processChildren(children)}</h4>,
        blockquote: ({ children, ...props }) => <blockquote {...props}>{processChildren(children)}</blockquote>,
    };

    return (
        <div className="stage-container stage-5">
            {!isFollowUp && <div className="stage-header" style={{ paddingTop: '32px', paddingBottom: '16px' }}>
                <div className="stage-title" style={{ display: 'flex', alignItems: 'center', fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', gap: '8px' }}>
                    <span className="stage-icon">✨</span>
                    Stage 5: Chairman Synthesis
                    {debateCount && debateCount.total > 0 && (
                        <span className="stage5-debate-count">
                            Debates included: {debateCount.run}/{debateCount.total} run
                        </span>
                    )}
                </div>
                <StageTimer startTime={startTime} endTime={endTime} label="Duration" />
            </div>}
            <div className="tabs" style={{ gridTemplateColumns: '1fr', maxWidth: '200px' }}>
                <button
                    className="tab active"
                    style={{ borderColor: 'rgba(234, 179, 8, 0.5)', color: '#ffffff' }}
                    title={finalResponse?.model}
                >
                    <span className="tab-name">{chairmanCharacterName || shortName}</span>
                </button>
            </div>
            <div className="final-response">
                <div className="chairman-header">
                    <div className="chairman-identity">
                        <div className="chairman-info">
                            <span className="chairman-model">{shortName}</span>
                        </div>
                    </div>
                    {!isFollowUp && <span className="chairman-verdict-badge">Chairman's Verdict</span>}
                    <CopyButton content={rawContent} />
                </div>
                <div className="final-text markdown-content">
                    <ThinkBlockRenderer
                        content={processedContent}
                        components={markdownComponents}
                    />
                </div>
                <CitationSection citations={finalResponse?.citations} />
            </div>
        </div>
    );
}
