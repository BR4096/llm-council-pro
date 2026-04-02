import { useState, useEffect } from 'react';
import { api } from '../api';
import './RoleSelector.css';

const ROLE_ICONS = {
  chess: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L9 7h6L12 2z"/>
      <rect x="8" y="7" width="8" height="3" rx="1"/>
      <path d="M9 10v2a3 3 0 006 0v-2"/>
      <path d="M7 17h10"/>
      <path d="M6 21h12"/>
      <path d="M9 17l-2 4"/>
      <path d="M15 17l2 4"/>
      <line x1="12" y1="14" x2="12" y2="17"/>
    </svg>
  ),
  pen: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
  ),
  users: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/>
      <path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
};

export default function RoleSelector({ onSelectRole }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRoles();
  }, []);

  const loadRoles = async () => {
    try {
      setLoading(true);
      const data = await api.getRoles();
      setRoles(data);
    } catch (err) {
      console.error('Failed to load roles:', err);
      setError('Failed to load council roles');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="role-selector">
        <div className="role-selector-loading">Loading councils...</div>
      </div>
    );
  }

  if (error || roles.length === 0) {
    return null;
  }

  return (
    <div className="role-selector">
      <h2 className="role-selector-title">Choose Your Council</h2>
      <p className="role-selector-subtitle">Select a pre-configured council to begin deliberation</p>
      <div className="role-cards">
        {roles.map((role) => (
          <button
            key={role.role_id}
            className="role-card"
            onClick={() => onSelectRole(role.role_id)}
          >
            <div className="role-card-icon">
              {ROLE_ICONS[role.icon] || ROLE_ICONS.chess}
            </div>
            <h3 className="role-card-name">{role.name}</h3>
            <p className="role-card-description">{role.description}</p>
            <div className="role-card-personas">
              {Object.values(role.character_names || {}).map((name, i) => (
                <span key={i} className="role-persona-tag">{name}</span>
              ))}
              {role.chairman_character_name && (
                <span className="role-persona-tag role-persona-chairman">
                  {role.chairman_character_name}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
