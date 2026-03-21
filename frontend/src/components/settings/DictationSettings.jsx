import React from 'react';

const LANGUAGES = [
    { code: 'auto', name: 'Auto-detect (Browser Language)' },
    { code: 'en-US', name: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)' },
    { code: 'es-ES', name: 'Spanish' },
    { code: 'fr-FR', name: 'French' },
    { code: 'de-DE', name: 'German' },
    { code: 'it-IT', name: 'Italian' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'ko-KR', name: 'Korean' },
    { code: 'zh-CN', name: 'Chinese (Simplified)' },
    { code: 'zh-TW', name: 'Chinese (Traditional)' },
];

export default function DictationSettings({ dictationLanguage, setDictationLanguage }) {
    return (
        <section className="settings-section">
            <h3>Voice Dictation</h3>
            <p className="section-description">
                Use your voice to dictate messages instead of typing. Works in Chrome, Edge, and Safari.
            </p>

            <div className="subsection">
                <label>Dictation Language</label>
                <p className="setting-description">
                    Select the language you will be speaking. Auto-detect uses your browser language setting.
                </p>
                <select
                    value={dictationLanguage}
                    onChange={(e) => setDictationLanguage(e.target.value)}
                    className="language-select"
                >
                    {LANGUAGES.map(lang => (
                        <option key={lang.code} value={lang.code}>
                            {lang.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="subsection" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <h4>How to Use</h4>
                <ul style={{ margin: '12px 0', lineHeight: '1.8', paddingLeft: '20px' }}>
                    <li>Click the microphone button next to the input field</li>
                    <li>Allow microphone access when prompted</li>
                    <li>Speak your message - text appears in real-time</li>
                    <li>Click the button again to stop, or click Send to submit</li>
                </ul>
            </div>
        </section>
    );
}
