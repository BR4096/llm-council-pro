import React from 'react';

export default function PromptSettings({
    prompts,
    handlePromptChange,
    handleResetPrompt,
    activePromptTab,
    setActivePromptTab,
    stage2Temperature,
    setStage2Temperature,
    stage3Temperature,
    setStage3Temperature,
    stage5Temperature,
    setStage5Temperature,
    defaultMemberRole,
    setDefaultMemberRole
}) {
    return (
        <section className="settings-section">
            <h3>System Prompts</h3>
            <p className="section-description">
                Customize the instructions given to the models at each stage.
            </p>

            <div className="prompts-tabs">
                <button
                    className={`prompt-tab ${activePromptTab === 'stage1' ? 'active' : ''}`}
                    onClick={() => setActivePromptTab('stage1')}
                >
                    Stage 1
                </button>
                <button
                    className={`prompt-tab ${activePromptTab === 'stage2' ? 'active' : ''}`}
                    onClick={() => setActivePromptTab('stage2')}
                >
                    Stage 2
                </button>
                <button
                    className={`prompt-tab ${activePromptTab === 'stage3' ? 'active' : ''}`}
                    onClick={() => setActivePromptTab('stage3')}
                >
                    Stage 3
                </button>
                <button
                    className={`prompt-tab ${activePromptTab === 'stage4' ? 'active' : ''}`}
                    onClick={() => setActivePromptTab('stage4')}
                >
                    Stage 4
                </button>
                <button
                    className={`prompt-tab ${activePromptTab === 'stage5' ? 'active' : ''}`}
                    onClick={() => setActivePromptTab('stage5')}
                >
                    Stage 5
                </button>
            </div>

            <div className="prompt-editor">
                {activePromptTab === 'stage1' && (
                    <div className="prompt-content">
                        <label>Stage 1: Initial Response</label>
                        <p className="section-description" style={{ marginBottom: '10px' }}>
                            Guides council members' initial responses to user questions.
                        </p>

                        {/* Default Member Role - only for Stage 1 */}
                        <div className="default-role-section" style={{ marginBottom: '16px', padding: '12px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.15)' }}>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#e2e8f0', fontSize: '13px' }}>
                                Default Member Role
                            </label>
                            <p className="section-description" style={{ marginBottom: '8px', fontSize: '12px' }}>
                                Fallback role for members without custom prompts. Leave empty for task-only prompts.
                            </p>
                            <input
                                type="text"
                                value={defaultMemberRole}
                                onChange={(e) => setDefaultMemberRole(e.target.value)}
                                placeholder="You are a helpful assistant."
                                style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
                            />
                        </div>

                        <p className="prompt-help">Variables: <code>{'{user_query}'}</code>, <code>{'{search_context_block}'}</code></p>
                        <textarea
                            value={prompts.stage1_prompt}
                            onChange={(e) => handlePromptChange('stage1_prompt', e.target.value)}
                            rows={15}
                        />
                        <button className="reset-prompt-btn" onClick={() => handleResetPrompt('stage1_prompt')}>Reset to Default</button>
                    </div>
                )}
                {activePromptTab === 'stage2' && (
                    <div className="prompt-content">
                        <label>Stage 2: Peer Ranking</label>
                        <p className="section-description" style={{ marginBottom: '12px' }}>
                            Instructs models how to rank and evaluate peer responses.
                        </p>

                        {/* Stage 2 Temperature Slider - Positioned prominently */}
                        <div className="stage2-heat-section" style={{ marginTop: '12px', marginBottom: '16px', padding: '15px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <div className="heat-slider-header">
                                <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0' }}>Stage 2 Heat</h4>
                                <span className="heat-value">{stage2Temperature.toFixed(1)}</span>
                            </div>
                            <p className="section-description" style={{ fontSize: '12px', margin: '8px 0' }}>
                                Lower temperature recommended for consistent, parseable ranking output.
                            </p>
                            <div className="heat-slider-container">
                                <span className="heat-icon cold">❄️</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={stage2Temperature}
                                    onChange={(e) => setStage2Temperature(parseFloat(e.target.value))}
                                    className="heat-slider"
                                />
                                <span className="heat-icon hot">🔥</span>
                            </div>
                        </div>

                        <p className="prompt-help">Variables: <code>{'{user_query}'}</code>, <code>{'{responses_text}'}</code>, <code>{'{search_context_block}'}</code></p>
                        <textarea
                            value={prompts.stage2_prompt}
                            onChange={(e) => handlePromptChange('stage2_prompt', e.target.value)}
                            rows={15}
                        />
                        <button className="reset-prompt-btn" onClick={() => handleResetPrompt('stage2_prompt')}>Reset to Default</button>
                    </div>
                )}
                {activePromptTab === 'stage3' && (
                    <div className="prompt-content">
                        <label>Stage 3: Revision</label>
                        <p className="section-description" style={{ marginBottom: '12px' }}>
                            Guides models in revising their responses based on peer critiques.
                        </p>

                        {/* Stage 3 Temperature Slider */}
                        <div className="stage3-heat-section" style={{ marginTop: '12px', marginBottom: '16px', padding: '15px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <div className="heat-slider-header">
                                <h4 style={{ margin: 0, fontSize: '14px', color: '#e2e8f0' }}>Stage 3 Heat</h4>
                                <span className="heat-value">{stage3Temperature.toFixed(1)}</span>
                            </div>
                            <p className="section-description" style={{ fontSize: '12px', margin: '8px 0' }}>
                                Controls creativity for council member response revisions.
                            </p>
                            <div className="heat-slider-container">
                                <span className="heat-icon cold">❄️</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={stage3Temperature}
                                    onChange={(e) => setStage3Temperature(parseFloat(e.target.value))}
                                    className="heat-slider"
                                />
                                <span className="heat-icon hot">🔥</span>
                            </div>
                        </div>

                        <p className="prompt-help">Variables: <code>{'{original_response}'}</code>, <code>{'{peer_critiques}'}</code></p>
                        <textarea
                            value={prompts.revision_prompt}
                            onChange={(e) => handlePromptChange('revision_prompt', e.target.value)}
                            rows={15}
                        />
                        <button className="reset-prompt-btn" onClick={() => handleResetPrompt('revision_prompt')}>Reset to Default</button>
                    </div>
                )}
                {activePromptTab === 'stage5' && (
                    <div className="prompt-content">
                        <label>Stage 5: Chairman Synthesis</label>
                        <p className="section-description" style={{ marginBottom: '10px' }}>
                            Directs the chairman to synthesize a final answer from all inputs.
                        </p>
                        <p className="prompt-help">Variables: <code>{'{user_query}'}</code>, <code>{'{stage1_text}'}</code>, <code>{'{stage2_text}'}</code>, <code>{'{search_context_block}'}</code></p>
                        <textarea
                            value={prompts.stage5_prompt}
                            onChange={(e) => handlePromptChange('stage5_prompt', e.target.value)}
                            rows={15}
                        />
                        <button className="reset-prompt-btn" onClick={() => handleResetPrompt('stage5_prompt')}>Reset to Default</button>
                    </div>
                )}
                {activePromptTab === 'stage4' && (
                    <div className="prompt-content">
                        <label>Stage 4: Debate</label>
                        <p className="section-description" style={{ marginBottom: '16px' }}>
                            Controls the tone and style of debate turns and the chairman's verdict. The JSON-structured prompts (highlights, issue selection) remain fixed to prevent breakage.
                        </p>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#e2e8f0', fontSize: '13px' }}>Opening Argument</label>
                            <p className="section-description" style={{ marginBottom: '8px', fontSize: '12px' }}>
                                Prompt for the first debater's opening position.
                            </p>
                            <p className="prompt-help" style={{ marginBottom: '10px' }}>Variables: <code>{'{persona}'}</code>, <code>{'{issue_title}'}</code>, <code>{'{original_query}'}</code>, <code>{'{stage3_response}'}</code></p>
                            <textarea
                                value={prompts.debate_turn_primary_a_prompt}
                                onChange={(e) => handlePromptChange('debate_turn_primary_a_prompt', e.target.value)}
                                rows={10}
                                style={{ marginBottom: '10px' }}
                            />
                            <button className="reset-prompt-btn" onClick={() => handleResetPrompt('debate_turn_primary_a_prompt')}>Reset to Default</button>
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#e2e8f0', fontSize: '13px' }}>Rebuttal</label>
                            <p className="section-description" style={{ marginBottom: '8px', fontSize: '12px' }}>
                                Prompt for subsequent debate turns responding to prior arguments.
                            </p>
                            <p className="prompt-help" style={{ marginBottom: '10px' }}>Variables: <code>{'{persona}'}</code>, <code>{'{issue_title}'}</code>, <code>{'{original_query}'}</code>, <code>{'{transcript_so_far}'}</code>, <code>{'{stage3_response}'}</code></p>
                            <textarea
                                value={prompts.debate_turn_rebuttal_prompt}
                                onChange={(e) => handlePromptChange('debate_turn_rebuttal_prompt', e.target.value)}
                                rows={10}
                                style={{ marginBottom: '10px' }}
                            />
                            <button className="reset-prompt-btn" onClick={() => handleResetPrompt('debate_turn_rebuttal_prompt')}>Reset to Default</button>
                        </div>

                        <div style={{ marginBottom: '8px' }}>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#e2e8f0', fontSize: '13px' }}>Chairman Verdict</label>
                            <p className="section-description" style={{ marginBottom: '8px', fontSize: '12px' }}>
                                Prompt for the chairman's final verdict on the debate.
                            </p>
                            <p className="prompt-help" style={{ marginBottom: '8px' }}>Variables: <code>{'{issue_title}'}</code>, <code>{'{transcript_text}'}</code>, <code>{'{participant_names}'}</code></p>
                            <p className="section-description" style={{ marginBottom: '10px', fontSize: '12px', color: '#f59e0b' }}>
                                This prompt must produce valid JSON output (<code>{"\"summary\""}</code> and <code>{"\"winner\""}</code> fields). Modify carefully.
                            </p>
                            <textarea
                                value={prompts.debate_verdict_prompt}
                                onChange={(e) => handlePromptChange('debate_verdict_prompt', e.target.value)}
                                rows={10}
                                style={{ marginBottom: '10px' }}
                            />
                            <button className="reset-prompt-btn" onClick={() => handleResetPrompt('debate_verdict_prompt')}>Reset to Default</button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
