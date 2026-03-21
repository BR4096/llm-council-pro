import './ExecutionModeToggle.css';

export default function ExecutionModeToggle({ value, onChange, disabled }) {
    const modes = [
        { id: 'chat_only', label: 'Chat Only', icon: '💬' },
        { id: 'chat_ranking', label: 'Chat + Ranking', icon: '🏅' },
        { id: 'revision', label: 'Chat + Revision', icon: '🔄' },
        { id: 'full', label: 'Full Deliberation', icon: '🏛️' }
    ];

    return (
        <div className="execution-mode-toggle" role="radiogroup" aria-label="Execution Mode">
            {modes.map(mode => (
                <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={value === mode.id}
                    className={`mode-option ${value === mode.id ? 'active' : ''}`}
                    onClick={() => !disabled && onChange(mode.id)}
                    disabled={disabled}
                    title={mode.label}
                >
                    <span className="mode-icon">{mode.icon}</span>
                    <span className="mode-label">{mode.label}</span>
                </button>
            ))}
        </div>
    );
}
