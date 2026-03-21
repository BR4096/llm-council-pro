import React, { useState, useMemo } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  isLoading,
  onAbort
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase().trim();
    return conversations.filter(conv => {
      // Search in title
      const titleMatch = (conv.title || 'New Conversation').toLowerCase().includes(query);
      return titleMatch;
    });
  }, [conversations, searchQuery]);

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  const handleAbortClick = (e) => {
    e.stopPropagation();
    onAbort();
  };

  const handleDeleteClick = (e, convId) => {
    e.stopPropagation();
    setConfirmingDelete(convId);
  };

  const handleConfirmDelete = (e, convId) => {
    e.stopPropagation();
    onDeleteConversation(convId);
    setConfirmingDelete(null);
  };

  const handleCancelDelete = (e) => {
    e.stopPropagation();
    setConfirmingDelete(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-wrapper">
          <img src="/assets/llmc-pro-48.png" alt="LLM Council" className="sidebar-logo" />
          <div className="sidebar-title">LLM Council <span className="title-plus">Pro</span></div>
        </div>
      </div>

      {/* Prominent New Discussion Button */}
      <div className="sidebar-actions">
        <button
          className="new-council-btn"
          onClick={onNewConversation}
          disabled={isLoading}
        >
          <span className="btn-icon">+</span>
          <span className="btn-text">New Discussion</span>
        </button>

        {/* Search Input */}
        <div className="search-container">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // Submit-on-enter: filtering is already live via onChange
              }
            }}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={handleClearSearch} title="Clear search">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="conversation-list">
        {filteredConversations.length === 0 ? (
          searchQuery.trim() ? (
            <div className="sidebar-empty-state search-empty">
              No conversations match '{searchQuery}'. Try different keywords.
            </div>
          ) : (
            <div className="sidebar-empty-state">No history</div>
          )
        ) : (
          filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">
                {conv.title || 'New Conversation'}
              </div>
              <div className="conversation-meta">
                <span>{new Date(conv.created_at).toLocaleDateString()}</span>
                {isLoading && conv.id === currentConversationId ? (
                  <button className="stop-generation-btn small" onClick={handleAbortClick}>
                    Stop
                  </button>
                ) : confirmingDelete === conv.id ? (
                  <div className="delete-confirm">
                    <button
                      className="confirm-yes-btn"
                      onClick={(e) => handleConfirmDelete(e, conv.id)}
                      title="Confirm delete"
                    >
                      ✓
                    </button>
                    <button
                      className="confirm-no-btn"
                      onClick={handleCancelDelete}
                      title="Cancel"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeleteClick(e, conv.id)}
                    title="Delete conversation"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Settings Button at Bottom */}
      <div className="sidebar-footer">
        <button className="settings-link" onClick={onOpenSettings}>
          <span className="settings-icon">⚙️</span>
          <span className="settings-label">Settings</span>
        </button>
      </div>
    </div>
  );
}
