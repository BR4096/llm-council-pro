import { useState, useEffect, useRef } from 'react';
import { api } from '../../api';

export default function PresetSettings({
  // Current config to save
  councilModels,
  chairmanModel,
  councilTemperature,
  chairmanTemperature,
  stage2Temperature,
  characterNames,
  memberPrompts,
  chairmanCharacterName,
  chairmanCustomPrompt,
  executionMode,
  webSearchEnabled,
  searchProvider,
  // Provider toggles to save/restore
  enabledProviders,
  directProviderToggles,
  // Callbacks to apply loaded preset
  onLoadPreset,
  onLoadProviders,
  // Callback when presets change (save/delete)
  onPresetsChange,
  // Frozen state
  isFrozen,
  // New discussion callback
  onNewDiscussion,
}) {
  const [presets, setPresets] = useState([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [expandedPreset, setExpandedPreset] = useState(null);

  // Batch selection state
  const [selectedPresetIds, setSelectedPresetIds] = useState(new Set());

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState(null);
  const [conflictMode, setConflictMode] = useState('skip');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Batch delete confirmation state
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    try {
      const data = await api.listPresets();
      setPresets(data);
    } catch (err) {
      setError('Failed to load presets');
    }
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) {
      setError('Please enter a preset name');
      return;
    }

    setIsLoading(true);
    setError(null);

    const config = {
      council_models: councilModels,
      chairman_model: chairmanModel,
      council_temperature: councilTemperature,
      chairman_temperature: chairmanTemperature,
      stage2_temperature: stage2Temperature,
      character_names: characterNames,
      member_prompts: memberPrompts,
      chairman_character_name: chairmanCharacterName,
      chairman_custom_prompt: chairmanCustomPrompt,
      execution_mode: executionMode,
      web_search_enabled: webSearchEnabled,
      search_provider: searchProvider,
      // Save provider toggles so presets can restore them
      enabled_providers: enabledProviders,
      direct_provider_toggles: directProviderToggles,
    };

    try {
      // Check if exists
      const existing = presets.find(p => p.name === newPresetName.trim());

      if (existing) {
        // Update existing
        await api.updatePreset(newPresetName.trim(), config);
        setSuccess(`Preset "${newPresetName.trim()}" updated!`);
      } else {
        // Create new
        await api.createPreset(newPresetName.trim(), config);
        setSuccess(`Preset "${newPresetName.trim()}" saved!`);
      }

      setNewPresetName('');
      await loadPresets();
      // Notify parent to refresh chat dropdown
      if (onPresetsChange) onPresetsChange();
    } catch (err) {
      setError(err.message || 'Failed to save preset');
    } finally {
      setIsLoading(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  const handleLoadPreset = async (presetName) => {
    setIsLoading(true);
    setError(null);

    try {
      const preset = presets.find(p => p.name === presetName);
      if (!preset) {
        setError('Preset not found');
        return;
      }

      const warnings = [];

      // Restore provider toggles if present in preset
      // Pass warnings array so onLoadProviders can add key-missing warnings
      // Capture filtered toggles to pass to onLoadPreset (avoids async state issues)
      let filteredToggles = null;
      if (onLoadProviders && preset.config?.enabled_providers) {
        filteredToggles = onLoadProviders(preset.config.enabled_providers, preset.config?.direct_provider_toggles, warnings);
      }

      if (onLoadPreset) {
        onLoadPreset(preset.config, warnings, filteredToggles);
      }

      if (warnings.length > 0) {
        setError(`Loaded with warnings: ${warnings.join(', ')}`);
        setTimeout(() => setError(null), 5000);
      } else {
        setSuccess(`Preset "${presetName}" loaded!`);
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Failed to load preset');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteClick = (presetName) => {
    setDeleteConfirm(presetName);
  };

  const handleDeleteConfirm = async (presetName) => {
    setIsLoading(true);
    try {
      await api.deletePreset(presetName);
      setSuccess(`Preset "${presetName}" deleted`);
      setDeleteConfirm(null);
      // Remove from selection if selected
      setSelectedPresetIds(prev => {
        const next = new Set(prev);
        next.delete(presetName);
        return next;
      });
      await loadPresets();
      // Notify parent to refresh chat dropdown
      if (onPresetsChange) onPresetsChange();
    } catch (err) {
      setError('Failed to delete preset');
    } finally {
      setIsLoading(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  // === Batch selection handlers ===

  const handleToggleSelect = (presetName, e) => {
    e.stopPropagation();
    setSelectedPresetIds(prev => {
      const next = new Set(prev);
      if (next.has(presetName)) {
        next.delete(presetName);
      } else {
        next.add(presetName);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPresetIds.size === presets.length && presets.length > 0) {
      setSelectedPresetIds(new Set());
    } else {
      setSelectedPresetIds(new Set(presets.map(p => p.name)));
    }
  };

  // === Batch delete handlers ===

  const handleBatchDeleteClick = () => {
    setBatchDeleteConfirm(true);
  };

  const handleBatchDeleteConfirm = async () => {
    setIsLoading(true);
    const names = Array.from(selectedPresetIds);
    let deleted = 0;
    let failed = 0;

    for (const name of names) {
      try {
        await api.deletePreset(name);
        deleted++;
      } catch (err) {
        failed++;
      }
    }

    setBatchDeleteConfirm(false);
    setSelectedPresetIds(new Set());
    await loadPresets();

    if (failed === 0) {
      setSuccess(`${deleted} preset${deleted !== 1 ? 's' : ''} deleted`);
    } else {
      setError(`Deleted ${deleted}, failed to delete ${failed}`);
    }

    setIsLoading(false);
    setTimeout(() => {
      setSuccess(null);
      setError(null);
    }, 3000);

    if (onPresetsChange) onPresetsChange();
  };

  const handleBatchDeleteCancel = () => {
    setBatchDeleteConfirm(false);
  };

  const allSelected = presets.length > 0 && selectedPresetIds.size === presets.length;
  const someSelected = selectedPresetIds.size > 0;

  // === Export handlers ===

  const triggerDownload = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSelected = async () => {
    if (!someSelected) return;
    const names = Array.from(selectedPresetIds);
    try {
      const data = await api.exportPresetsBatch(names);
      triggerDownload(data, 'council-presets-selected.json');
      setSuccess(`Exported ${data.length} preset${data.length !== 1 ? 's' : ''}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to export selected presets');
    }
  };

  // === Import handlers ===

  const handleImportClick = () => {
    setImportData(null);
    setImportResult(null);
    setConflictMode('skip');
    setShowImportModal(true);
    // Small delay to let the modal render before triggering file input
    setTimeout(() => fileInputRef.current?.click(), 100);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        // Validate it's an array of {name, config} objects
        if (!Array.isArray(parsed)) {
          setError('Invalid file format: expected a JSON array of presets');
          setShowImportModal(false);
          return;
        }
        const valid = parsed.filter(item => item && typeof item.name === 'string' && item.config);
        if (valid.length === 0) {
          setError('No valid presets found in file');
          setShowImportModal(false);
          return;
        }
        setImportData(valid);
        setImportResult(null);
      } catch {
        setError('Failed to parse JSON file');
        setShowImportModal(false);
      }
    };
    reader.readAsText(file);
    // Reset the input so the same file can be re-selected
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!importData || importData.length === 0) return;
    setImporting(true);
    try {
      const result = await api.importPresetsBatch(importData, conflictMode);
      setImportResult(result);
      await loadPresets();
      if (onPresetsChange) onPresetsChange();
    } catch (err) {
      setError(err.message || 'Failed to import presets');
      setShowImportModal(false);
    } finally {
      setImporting(false);
    }
  };

  const handleCloseImportModal = () => {
    setShowImportModal(false);
    setImportData(null);
    setImportResult(null);
  };

  // Compute conflict status for preview
  const presetNameSet = new Set(presets.map(p => p.name));
  const importPreviewItems = importData
    ? importData.map(item => ({
        name: item.name,
        conflict: presetNameSet.has(item.name),
      }))
    : [];

  return (
    <section className="settings-section">
      {isFrozen && (
        <div className="frozen-banner">
          <span className="frozen-banner-icon">🔒</span>
          <span className="frozen-banner-text">
            Settings are locked for this conversation. Start a{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onNewDiscussion(); }}>
              new discussion
            </a>{' '}
            to change config.
          </span>
        </div>
      )}
      <h3>Council Presets</h3>
      <p className="section-description">
        Save and load council configurations as reusable templates.
        All presets are user-created.
      </p>

      {/* Create New Preset */}
      <div className="subsection">
        <h4>Save Current Config</h4>
        <div className="preset-create-form">
          <input
            type="text"
            className="preset-name-input"
            placeholder="Preset name..."
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            disabled={isLoading}
          />
          <button
            className="action-btn"
            onClick={handleSavePreset}
            disabled={isLoading || !newPresetName.trim()}
          >
            {isLoading ? 'Saving...' : 'Save Preset'}
          </button>
        </div>
      </div>

      {/* Preset List */}
      <div className="subsection">
        <h4>Saved Presets</h4>

        {/* Batch action bar */}
        <div className="preset-batch-actions">
          {presets.length > 0 && (
            <button
              className="action-btn"
              onClick={handleSelectAll}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}
          <button
            className="action-btn"
            onClick={handleExportSelected}
            disabled={!someSelected}
            title={someSelected ? `Export ${selectedPresetIds.size} selected preset(s)` : 'Select presets to export'}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            Export{someSelected ? ` (${selectedPresetIds.size})` : ''}
          </button>
          <button
            className="action-btn"
            onClick={handleImportClick}
            title="Import presets from JSON file"
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            Import
          </button>
          {/* Spacer to push delete to the right */}
          <div style={{ flex: 1 }} />
          {batchDeleteConfirm ? (
            <>
              <span className="confirm-text">Delete {selectedPresetIds.size}?</span>
              <button
                className="action-btn danger"
                onClick={handleBatchDeleteConfirm}
                disabled={isLoading}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                Yes
              </button>
              <button
                className="action-btn"
                onClick={handleBatchDeleteCancel}
                disabled={isLoading}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                No
              </button>
            </>
          ) : (
            <button
              className="action-btn danger"
              onClick={handleBatchDeleteClick}
              disabled={!someSelected}
              title={someSelected ? `Delete ${selectedPresetIds.size} selected preset(s)` : 'Select presets to delete'}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              Delete{someSelected ? ` (${selectedPresetIds.size})` : ''}
            </button>
          )}
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {presets.length === 0 ? (
          <p className="empty-state-text">No presets saved yet.</p>
        ) : (
          <div className="preset-list">
            {presets.map((preset) => (
              <div key={preset.name} className="preset-item-wrapper">
                <div
                  className="preset-item"
                  onClick={() => setExpandedPreset(
                    expandedPreset === preset.name ? null : preset.name
                  )}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    className="preset-checkbox"
                    checked={selectedPresetIds.has(preset.name)}
                    onChange={(e) => handleToggleSelect(preset.name, e)}
                    onClick={(e) => e.stopPropagation()}
                    title="Select for batch operations"
                  />
                  <div className="preset-info">
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-preview">
                      {preset.config?.council_models?.length || 0} models + chairman
                      {preset.config?.execution_mode !== 'full' && ` · ${preset.config.execution_mode}`}
                    </span>
                  </div>
                  <div className="preset-actions">
                    {deleteConfirm === preset.name ? (
                      <>
                        <span className="confirm-text">Delete?</span>
                        <button
                          className="action-btn danger"
                          onClick={(e) => { e.stopPropagation(); handleDeleteConfirm(preset.name); }}
                          disabled={isLoading}
                        >
                          Yes
                        </button>
                        <button
                          className="action-btn"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                          disabled={isLoading}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="preset-icon-btn"
                          onClick={(e) => { e.stopPropagation(); handleLoadPreset(preset.name); }}
                          disabled={isLoading || isFrozen}
                          title={isFrozen ? "Start a new discussion to load a preset" : "Load preset"}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="19" x2="12" y2="5" />
                            <polyline points="5 12 12 5 19 12" />
                          </svg>
                        </button>
                        <button
                          className="preset-icon-btn preset-icon-btn-danger"
                          onClick={(e) => { e.stopPropagation(); handleDeleteClick(preset.name); }}
                          disabled={isLoading}
                          title="Delete preset"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {/* Expandable accordion showing member details */}
                {expandedPreset === preset.name && (
                  <div className="preset-accordion">
                    <div className="preset-accordion-headers">
                      <div className="preset-accordion-header-left">Council Members</div>
                      <div className="preset-accordion-header-right">Models</div>
                    </div>
                    {(preset.config?.council_models || []).map((modelId, index) => {
                      const charName = preset.config?.character_names?.[index];
                      const displayName = charName || `Member #${index + 1}`;
                      return (
                        <div key={index} className="preset-member-row">
                          <span className="preset-member-name">{displayName}</span>
                          <span className="preset-member-model">{modelId}</span>
                        </div>
                      );
                    })}

                    <div className="preset-accordion-headers" style={{ marginTop: '12px' }}>
                      <div className="preset-accordion-header-left">Chairman</div>
                      <div className="preset-accordion-header-right">Model</div>
                    </div>
                    <div className="preset-member-row">
                      <span className="preset-member-name">
                        {preset.config?.chairman_character_name || 'Chairman'}
                      </span>
                      <span className="preset-member-model">
                        {preset.config?.chairman_model || 'Not set'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast Messages */}
      {error && <div className="settings-error">{error}</div>}
      {success && <div className="settings-success">{success}</div>}

      {/* Import Modal */}
      {showImportModal && (
        <div className="import-modal-overlay" onClick={handleCloseImportModal}>
          <div className="import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="import-modal-header">
              <h3>Import Presets</h3>
              <button className="import-modal-close" onClick={handleCloseImportModal}>
                &times;
              </button>
            </div>

            {!importData && !importResult && (
              <div className="import-modal-body">
                <p className="import-instructions">
                  Select a JSON file exported from this app to import presets.
                </p>
                <button
                  className="action-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose File
                </button>
              </div>
            )}

            {importData && !importResult && (
              <div className="import-modal-body">
                <p className="import-instructions">
                  Found <strong>{importData.length}</strong> preset{importData.length !== 1 ? 's' : ''} to import:
                </p>

                <ul className="import-preview-list">
                  {importPreviewItems.map((item) => (
                    <li key={item.name} className={item.conflict ? 'conflict' : ''}>
                      {item.name}
                      {item.conflict && (
                        <span className="import-conflict-badge">exists</span>
                      )}
                    </li>
                  ))}
                </ul>

                {importPreviewItems.some(i => i.conflict) && (
                  <div className="import-conflict-mode">
                    <label htmlFor="conflict-mode-select">
                      Conflict resolution:
                    </label>
                    <select
                      id="conflict-mode-select"
                      value={conflictMode}
                      onChange={(e) => setConflictMode(e.target.value)}
                    >
                      <option value="skip">Skip existing</option>
                      <option value="overwrite">Overwrite existing</option>
                      <option value="rename">Rename (add suffix)</option>
                    </select>
                  </div>
                )}

                <div className="import-actions">
                  <button className="action-btn" onClick={handleCloseImportModal}>
                    Cancel
                  </button>
                  <button
                    className="action-btn"
                    onClick={handleImport}
                    disabled={importing}
                  >
                    {importing ? 'Importing...' : `Import ${importData.length} preset${importData.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            )}

            {importResult && (
              <div className="import-modal-body">
                <div className="import-result">
                  <p className="import-result-title">Import complete</p>
                  <ul className="import-result-list">
                    <li className="imported">
                      <span className="import-result-count">{importResult.imported}</span>
                      imported
                    </li>
                    {importResult.skipped > 0 && (
                      <li className="skipped">
                        <span className="import-result-count">{importResult.skipped}</span>
                        skipped
                      </li>
                    )}
                    {importResult.renamed > 0 && (
                      <li className="renamed">
                        <span className="import-result-count">{importResult.renamed}</span>
                        renamed
                      </li>
                    )}
                    {importResult.errors && importResult.errors.length > 0 && (
                      <li className="errors">
                        <span className="import-result-count">{importResult.errors.length}</span>
                        error{importResult.errors.length !== 1 ? 's' : ''}
                      </li>
                    )}
                  </ul>
                </div>
                <div className="import-actions">
                  <button className="action-btn" onClick={handleCloseImportModal}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
