import { useState } from 'react';
import './LoginScreen.css';

/**
 * Login screen for invite-code authentication.
 * Renders a single input field for the access code with submit button.
 */
export default function LoginScreen({ onLogin }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8001`}/api/auth/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.trim() }),
        }
      );

      if (!response.ok) {
        setError('Invalid access code');
        setLoading(false);
        return;
      }

      const data = await response.json();
      onLogin(data.token, data.role, data.label);
    } catch (err) {
      setError('Connection error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">LLM Council</h1>
        <p className="login-subtitle">Enter your access code to continue</p>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Access code"
            className="login-input"
            autoFocus
            disabled={loading}
          />
          <button
            type="submit"
            className="login-button"
            disabled={loading || !code.trim()}
          >
            {loading ? 'Verifying...' : 'Enter'}
          </button>
        </form>

        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
