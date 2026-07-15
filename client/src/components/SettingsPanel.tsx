import React, { useState, useEffect, useCallback } from 'react';
import { ConfigResponse, DashboardConfig, PriorityLabelConfig, KitchenPhrases, SLAConfig, DisplayOptions } from '@camtom/shared';
import { IconX, IconSettings, IconVolume, IconCheckmark, IconPlus } from './Icons';
import { PRIORITY_LEVELS, PRIORITY_BY_LEVEL } from '../lib/priorities';

const SETTINGS_STORAGE_KEY = 'camtom-settings-overrides';

interface SettingsOverrides {
  title?: string;
  teamMembers?: string[];
  priorityLabels?: Record<number, Partial<PriorityLabelConfig>>;
  kitchenPhrases?: Partial<KitchenPhrases>;
  slaWindowHours?: number;
  displayOptions?: Partial<DisplayOptions>;
}

interface SettingsPanelProps {
  config: ConfigResponse | null;
  onApply: (overrides: SettingsOverrides) => void;
  onClose: () => void;
}

function loadOverrides(): SettingsOverrides {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveOverrides(overrides: SettingsOverrides): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage may be full
  }
}

type TabId = 'general' | 'display' | 'sla' | 'labels' | 'sounds';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'display', label: 'Display' },
  { id: 'sla', label: 'SLA' },
  { id: 'labels', label: 'Labels & Phrases' },
  { id: 'sounds', label: 'Sounds' },
];

export function SettingsPanel({ config, onApply, onClose }: SettingsPanelProps) {
  const [overrides, setOverrides] = useState<SettingsOverrides>(loadOverrides);
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Sound preview state
  const [previewVolume, setPreviewVolume] = useState(0.5);

  // SLA editing state
  const [slaRules, setSlaRules] = useState<SLAConfig[]>(() => config?.slas ?? []);
  const [editingSla, setEditingSla] = useState<SLAConfig | null>(null);
  const [slaValidation, setSlaValidation] = useState<string | null>(null);

  // Derived values
  const title = overrides.title ?? config?.dashboard?.title ?? 'Camtom Ticket Dashboard';
  const teamMembers = overrides.teamMembers ?? config?.dashboard?.teamMembers ?? [];
  const kitchenPhrases = { ...config?.dashboard?.kitchenPhrases, ...overrides.kitchenPhrases } as KitchenPhrases;
  const slaWindowHours = overrides.slaWindowHours ?? config?.dashboard?.report?.slaWindowHours ?? 24;
  const displayOptions: Partial<DisplayOptions> = {
    ...config?.dashboard?.displayOptions,
    ...overrides.displayOptions,
  };

  // Merge priority labels
  const priorityLabels: Record<number, Partial<PriorityLabelConfig>> = {};
  for (const pk of PRIORITY_LEVELS) {
    priorityLabels[pk] = {
      ...config?.dashboard?.priorityLabels?.[pk],
      ...overrides.priorityLabels?.[pk],
    };
  }

  const setOverride = useCallback(<K extends keyof SettingsOverrides>(key: K, value: SettingsOverrides[K]) => {
    setOverrides((prev) => {
      const next = { ...prev, [key]: value };
      saveOverrides(next);
      return next;
    });
  }, []);

  const setNestedOverride = useCallback(<K extends keyof SettingsOverrides>(key: K, subKey: string, value: any) => {
    setOverrides((prev) => {
      const current = (prev[key] as any) ?? {};
      const next = { ...prev, [key]: { ...current, [subKey]: value } };
      saveOverrides(next);
      return next;
    });
  }, []);

  const setPriorityOverride = useCallback((priority: number, field: keyof PriorityLabelConfig, value: string) => {
    setOverrides((prev) => {
      const current = prev.priorityLabels?.[priority] ?? {};
      const next = {
        ...prev,
        priorityLabels: {
          ...prev.priorityLabels,
          [priority]: { ...current, [field]: value },
        },
      };
      saveOverrides(next);
      return next;
    });
  }, []);

  const setPhrase = useCallback((key: keyof KitchenPhrases, value: string) => {
    setOverrides((prev) => {
      const next = {
        ...prev,
        kitchenPhrases: { ...prev.kitchenPhrases, [key]: value },
      };
      saveOverrides(next);
      return next;
    });
  }, []);

  const addTeamMember = useCallback((name: string) => {
    if (!name.trim()) return;
    setOverrides((prev) => {
      const next = {
        ...prev,
        teamMembers: [...(prev.teamMembers ?? teamMembers), name.trim()],
      };
      saveOverrides(next);
      return next;
    });
  }, [teamMembers]);

  const removeTeamMember = useCallback((index: number) => {
    setOverrides((prev) => {
      const current = prev.teamMembers ?? teamMembers;
      const next = {
        ...prev,
        teamMembers: current.filter((_, i) => i !== index),
      };
      saveOverrides(next);
      return next;
    });
  }, [teamMembers]);

  const [newMemberName, setNewMemberName] = useState('');

  // SLA handlers
  const handleAddSla = () => {
    const newSla: SLAConfig = {
      id: `sla_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: 'New SLA',
      applicablePriorities: [1, 2],
      maxMinutes: 30,
      warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
    };
    setSlaRules([...slaRules, newSla]);
    setEditingSla(newSla);
  };

  const handleRemoveSla = (id: string) => {
    setSlaRules(slaRules.filter((s) => s.id !== id));
    if (editingSla?.id === id) setEditingSla(null);
  };

  const handleSaveSla = (sla: SLAConfig) => {
    // Validate
    if (sla.maxMinutes < 1) {
      setSlaValidation('maxMinutes must be ≥ 1');
      return;
    }
    if (!sla.label.trim()) {
      setSlaValidation('Label is required');
      return;
    }
    if (sla.applicablePriorities.length === 0) {
      setSlaValidation('At least one applicable priority required');
      return;
    }
    setSlaValidation(null);
    setSlaRules(slaRules.map((s) => (s.id === sla.id ? sla : s)));
    setEditingSla(null);
  };

  const toggleSlaPriority = (sla: SLAConfig, priority: number) => {
    const next = sla.applicablePriorities.includes(priority)
      ? sla.applicablePriorities.filter((p) => p !== priority)
      : [...sla.applicablePriorities, priority];
    setEditingSla({ ...sla, applicablePriorities: next });
  };

  // Sound preview
  const handlePreviewSound = (soundName: string) => {
    try {
      (window as any).cuelume?.play(soundName);
    } catch {
      // ignore
    }
  };

  // Reset
  const handleReset = () => {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    setOverrides({});
    onApply({});
  };

  // Save to server
  const handleSaveToServer = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const body: Record<string, any> = {};

      // Build dashboard update from overrides
      const dashUpdate: Record<string, any> = {};
      if (overrides.title !== undefined) dashUpdate.title = overrides.title;
      if (overrides.teamMembers !== undefined) dashUpdate.teamMembers = overrides.teamMembers;
      if (overrides.kitchenPhrases !== undefined) dashUpdate.kitchenPhrases = overrides.kitchenPhrases;
      if (overrides.displayOptions !== undefined) {
        dashUpdate.displayOptions = {
          ...config?.dashboard?.displayOptions,
          ...overrides.displayOptions,
        };
      }
      if (overrides.priorityLabels !== undefined) {
        dashUpdate.priorityLabels = {};
        for (const pk of PRIORITY_LEVELS) {
          if (overrides.priorityLabels[pk]) {
            dashUpdate.priorityLabels[pk] = {
              ...config?.dashboard?.priorityLabels?.[pk],
              ...overrides.priorityLabels[pk],
            };
          }
        }
      }
      if (overrides.slaWindowHours !== undefined) {
        dashUpdate.report = {
          ...config?.dashboard?.report,
          slaWindowHours: overrides.slaWindowHours,
        };
      }

      if (Object.keys(dashUpdate).length > 0) {
        body.dashboard = dashUpdate;
      }

      // Include SLA rules
      const hasSlaChanges = slaRules.length > 0 && JSON.stringify(slaRules) !== JSON.stringify(config?.slas);
      if (hasSlaChanges) {
        body.slas = slaRules;
      }

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Apply settings to parent on every change
  useEffect(() => {
    onApply(overrides);
  }, [overrides, onApply]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard Settings"
        style={{
          background: '#1A0F0A',
          border: '2px solid rgba(255,99,71,0.3)',
          borderRadius: 'var(--radius-card)',
          width: '90vw',
          maxWidth: 800,
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(180deg, #2C1810 0%, #1A0F0A 100%)',
            padding: 'var(--space-lg) var(--space-xl)',
            borderBottom: '2px solid rgba(255,99,71,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <IconSettings size={24} style={{ color: 'var(--color-tomato)' }} />
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-2xl)',
                color: 'var(--color-mayo)',
                margin: 0,
                letterSpacing: '0.05em',
              }}
            >
              Dashboard Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '50%',
              width: 36,
              height: 36,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.6)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '0 var(--space-xl)',
            flexShrink: 0,
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--color-tomato)' : '2px solid transparent',
                padding: 'var(--space-sm) var(--space-md)',
                cursor: 'pointer',
                color: activeTab === tab.id ? 'var(--color-tomato)' : 'rgba(255,255,255,0.5)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-sm)',
                letterSpacing: '0.05em',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div
          style={{
            padding: 'var(--space-xl)',
            overflow: 'auto',
            flex: 1,
          }}
        >
          {/* Tab: General */}
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
              <Section label="General">
                <FieldRow label="Dashboard Title">
                  <input
                    value={title}
                    onChange={(e) => setOverride('title', e.target.value)}
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="SLA Window (hours)">
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={slaWindowHours}
                    onChange={(e) => setOverride('slaWindowHours', Number(e.target.value))}
                    style={{ ...inputStyle, width: 80 }}
                  />
                </FieldRow>
              </Section>

              <Section label="Team Members">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {teamMembers.map((name, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--color-mayo)' }}>{name}</span>
                      <button
                        onClick={() => removeTeamMember(i)}
                        style={{
                          background: 'rgba(255,99,71,0.15)',
                          border: '1px solid rgba(255,99,71,0.3)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-ketchup)',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: 'var(--text-xs)',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <input
                      placeholder="Add team member..."
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newMemberName.trim()) {
                          addTeamMember(newMemberName);
                          setNewMemberName('');
                        }
                      }}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => {
                        if (newMemberName.trim()) {
                          addTeamMember(newMemberName);
                          setNewMemberName('');
                        }
                      }}
                      style={{
                        background: 'var(--color-tomato)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: '#fff',
                        cursor: 'pointer',
                        padding: '4px 16px',
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--text-sm)',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </Section>
            </div>
          )}

          {/* Tab: Display */}
          {activeTab === 'display' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
              <Section label="Timer Style">
                <FieldRow label="Timer display">
                  <select
                    value={displayOptions.timerStyle ?? 'circle'}
                    onChange={(e) => setNestedOverride('displayOptions', 'timerStyle', e.target.value)}
                    style={{ ...selectStyle, width: 140 }}
                  >
                    <option value="circle">Circle</option>
                    <option value="bar">Bar</option>
                  </select>
                </FieldRow>
              </Section>

              <Section label="Animation Intensity">
                <FieldRow label="Animations">
                  <select
                    value={displayOptions.animationIntensity ?? 'full'}
                    onChange={(e) => setNestedOverride('displayOptions', 'animationIntensity', e.target.value)}
                    style={{ ...selectStyle, width: 140 }}
                  >
                    <option value="off">Off</option>
                    <option value="subtle">Subtle</option>
                    <option value="full">Full</option>
                  </select>
                </FieldRow>
              </Section>

              <Section label="Column Visibility">
                {PRIORITY_LEVELS.map((pk) => {
                  const visible = displayOptions.columnVisibility?.[pk] ?? true;
                  return (
                    <FieldRow key={pk} label={PRIORITY_BY_LEVEL[pk].name}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 'var(--text-sm)' }}>
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => {
                            const current = displayOptions.columnVisibility ?? {};
                            setNestedOverride('displayOptions', 'columnVisibility', {
                              ...current,
                              [pk]: !visible,
                            });
                          }}
                          style={{ accentColor: 'var(--color-tomato)' }}
                        />
                        {visible ? 'Visible' : 'Hidden'}
                      </label>
                    </FieldRow>
                  );
                })}
              </Section>
            </div>
          )}

          {/* Tab: SLA */}
          {activeTab === 'sla' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {slaValidation && (
                <div style={{ color: 'var(--color-ketchup)', fontSize: 'var(--text-xs)', padding: 'var(--space-xs) 0' }}>
                  {slaValidation}
                </div>
              )}
              {slaRules.map((sla) => (
                <div
                  key={sla.id}
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-sm) var(--space-md)',
                    border: editingSla?.id === sla.id ? '1px solid var(--color-tomato)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {editingSla?.id === sla.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', minWidth: 40 }}>Label</span>
                        <input
                          value={editingSla.label}
                          onChange={(e) => setEditingSla({ ...editingSla, label: e.target.value })}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', minWidth: 40 }}>Minutes</span>
                        <input
                          type="number"
                          min={1}
                          value={editingSla.maxMinutes}
                          onChange={(e) => setEditingSla({ ...editingSla, maxMinutes: Math.max(1, Number(e.target.value)) })}
                          style={{ ...inputStyle, width: 80 }}
                        />
                      </div>
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', minWidth: 40 }}>Thresholds</span>
                        {(['warming', 'heating', 'critical'] as const).map((tier) => (
                          <label key={tier} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.6)' }}>
                            {tier}
                            <input
                              type="number"
                              min={0.01}
                              max={0.99}
                              step={0.05}
                              value={editingSla.warningThresholds[tier]}
                              onChange={(e) =>
                                setEditingSla({
                                  ...editingSla,
                                  warningThresholds: {
                                    ...editingSla.warningThresholds,
                                    [tier]: Number(e.target.value),
                                  },
                                })
                              }
                              style={{ ...inputStyle, width: 60 }}
                            />
                          </label>
                        ))}
                      </div>
                      <div>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', display: 'block', marginBottom: 4 }}>Applicable Priorities</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {[1, 2, 3, 4, 0].map((p) => (
                            <button
                              key={p}
                              onClick={() => toggleSlaPriority(editingSla, p)}
                              style={{
                                padding: '2px 10px',
                                borderRadius: 'var(--radius-pill)',
                                border: `1px solid ${editingSla.applicablePriorities.includes(p) ? 'var(--color-tomato)' : 'rgba(255,255,255,0.15)'}`,
                                background: editingSla.applicablePriorities.includes(p) ? 'rgba(255,99,71,0.2)' : 'transparent',
                                color: editingSla.applicablePriorities.includes(p) ? 'var(--color-tomato)' : 'rgba(255,255,255,0.5)',
                                cursor: 'pointer',
                                fontFamily: 'var(--font-body)',
                                fontSize: 'var(--text-xs)',
                              }}
                            >
                              {PRIORITY_BY_LEVEL[p].name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                        <button
                          onClick={() => setEditingSla(null)}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            padding: '4px 12px',
                            fontSize: 'var(--text-xs)',
                            fontFamily: 'var(--font-display)',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveSla(editingSla)}
                          style={{
                            background: 'var(--color-tomato)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: '#fff',
                            cursor: 'pointer',
                            padding: '4px 12px',
                            fontSize: 'var(--text-xs)',
                            fontFamily: 'var(--font-display)',
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--color-mayo)' }}>
                        {sla.label}
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)' }}>
                        {sla.maxMinutes}min
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)' }}>
                        P{sla.applicablePriorities.sort().join(',P')}
                      </span>
                      <button
                        onClick={() => setEditingSla(sla)}
                        style={{
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'rgba(255,255,255,0.6)',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: 'var(--text-xs)',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemoveSla(sla.id)}
                        style={{
                          background: 'rgba(255,99,71,0.15)',
                          border: '1px solid rgba(255,99,71,0.3)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-ketchup)',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: 'var(--text-xs)',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={handleAddSla}
                style={{
                  background: 'transparent',
                  border: '1px dashed rgba(255,255,255,0.2)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  padding: '8px',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-sm)',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <IconPlus size={14} /> Add SLA Rule
              </button>
            </div>
          )}

          {/* Tab: Labels & Phrases */}
          {activeTab === 'labels' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
              <Section label="Priority Labels & Colors">
                {PRIORITY_LEVELS.map((pk) => {
                  const pl = priorityLabels[pk] || { label: PRIORITY_BY_LEVEL[pk].name, color: '#888', dotColor: '#888' };
                  return (
                    <div key={pk} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <span style={{ minWidth: 80, fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.7)' }}>
                        {PRIORITY_BY_LEVEL[pk].name}
                      </span>
                      <input
                        value={pl.label ?? ''}
                        onChange={(e) => setPriorityOverride(pk, 'label', e.target.value)}
                        placeholder="Label"
                        style={{ ...inputStyle, width: 120 }}
                      />
                      <input
                        type="color"
                        value={pl.dotColor ?? '#888'}
                        onChange={(e) => setPriorityOverride(pk, 'dotColor', e.target.value)}
                        style={{ width: 32, height: 32, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0 }}
                      />
                      <input
                        value={pl.color ?? ''}
                        onChange={(e) => setPriorityOverride(pk, 'color', e.target.value)}
                        placeholder="CSS var"
                        style={{ ...inputStyle, width: 120, fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}
                      />
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: pl.dotColor ?? '#888', flexShrink: 0 }} />
                    </div>
                  );
                })}
              </Section>

              <Section label="Kitchen Phrases">
                <FieldRow label="Empty state">
                  <input
                    value={kitchenPhrases.emptyState ?? ''}
                    onChange={(e) => setPhrase('emptyState', e.target.value)}
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="Warning timer">
                  <input
                    value={kitchenPhrases.warningTimer ?? ''}
                    onChange={(e) => setPhrase('warningTimer', e.target.value)}
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="Breached timer">
                  <input
                    value={kitchenPhrases.breachedTimer ?? ''}
                    onChange={(e) => setPhrase('breachedTimer', e.target.value)}
                    style={inputStyle}
                  />
                </FieldRow>
              </Section>
            </div>
          )}

          {/* Tab: Sounds */}
          {activeTab === 'sounds' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
              <Section label="Volume">
                <FieldRow label="Preview Volume">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={previewVolume}
                    onChange={(e) => setPreviewVolume(Number(e.target.value))}
                    style={{ width: 200, accentColor: 'var(--color-tomato)' }}
                  />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.5)', minWidth: 30 }}>
                    {Math.round(previewVolume * 100)}%
                  </span>
                </FieldRow>
              </Section>

              <Section label="Sound Previews">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { name: 'sparkle', label: 'New Urgent' },
                    { name: 'tick', label: 'Warning' },
                    { name: 'press', label: 'Breach' },
                    { name: 'success', label: 'Success' },
                    { name: 'chime', label: 'Chime' },
                  ].map((snd) => (
                    <button
                      key={snd.name}
                      onClick={() => handlePreviewSound(snd.name)}
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '6px 14px',
                        cursor: 'pointer',
                        color: 'var(--color-mayo)',
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--text-xs)',
                        letterSpacing: '0.05em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <IconVolume size={14} /> {snd.label}
                    </button>
                  ))}
                </div>
              </Section>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          style={{
            padding: 'var(--space-md) var(--space-xl)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {saveStatus && saveStatus !== 'saved' && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', color: 'var(--color-ketchup)', marginRight: 'auto' }}>
              {saveStatus}
            </div>
          )}
          {saveStatus === 'saved' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', color: 'var(--color-lettuce)', marginRight: 'auto' }}>
              <IconCheckmark size={12} /> Saved
            </div>
          )}
          <button
            onClick={handleReset}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 'var(--radius-sm)',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              padding: '8px 20px',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-sm)',
              letterSpacing: '0.05em',
            }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSaveToServer}
            disabled={saving}
            style={{
              background: saving ? 'rgba(255,99,71,0.5)' : 'var(--color-tomato)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: '#fff',
              cursor: saving ? 'wait' : 'pointer',
              padding: '8px 24px',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-sm)',
              letterSpacing: '0.05em',
            }}
          >
            {saving ? 'Saving...' : 'Save to Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Helper components ---

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-base)',
          color: 'var(--color-mustard)',
          margin: '0 0 var(--space-md)',
          letterSpacing: '0.05em',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'var(--space-xs)',
        }}
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <span style={{ minWidth: 140, fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.6)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  color: 'var(--color-mayo)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  flex: 1,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};
