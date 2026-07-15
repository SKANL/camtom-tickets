import React, { useState, useEffect, useCallback } from 'react';
import { ConfigResponse, PriorityLabelConfig, KitchenPhrases, SLAConfig, DisplayOptions } from '@camtom/shared';
import { IconX, IconSettings, IconCheckmark } from './Icons';
import { PRIORITY_LEVELS } from '../lib/priorities';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { GeneralTab } from './settings/GeneralTab';
import { DisplayTab } from './settings/DisplayTab';
import { SlaTab } from './settings/SlaTab';
import { LabelsTab } from './settings/LabelsTab';
import { SoundsTab } from './settings/SoundsTab';

const SETTINGS_STORAGE_KEY = 'camtom-settings-overrides';

export interface SettingsOverrides {
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
          {activeTab === 'general' && (
            <GeneralTab
              title={title}
              slaWindowHours={slaWindowHours}
              teamMembers={teamMembers}
              newMemberName={newMemberName}
              setNewMemberName={setNewMemberName}
              addTeamMember={addTeamMember}
              removeTeamMember={removeTeamMember}
              setOverride={setOverride}
            />
          )}

          {activeTab === 'display' && (
            <DisplayTab
              displayOptions={displayOptions}
              setNestedOverride={setNestedOverride}
            />
          )}

          {activeTab === 'sla' && (
            <SlaTab
              slaRules={slaRules}
              editingSla={editingSla}
              slaValidation={slaValidation}
              handleAddSla={handleAddSla}
              handleRemoveSla={handleRemoveSla}
              handleSaveSla={handleSaveSla}
              toggleSlaPriority={toggleSlaPriority}
              setEditingSla={setEditingSla}
            />
          )}

          {activeTab === 'labels' && (
            <LabelsTab
              priorityLabels={priorityLabels}
              kitchenPhrases={kitchenPhrases}
              setPriorityOverride={setPriorityOverride}
              setPhrase={setPhrase}
            />
          )}

          {activeTab === 'sounds' && (
            <SoundsTab
              previewVolume={previewVolume}
              setPreviewVolume={setPreviewVolume}
              handlePreviewSound={handlePreviewSound}
            />
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
            <Badge style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', color: 'var(--color-lettuce)', marginRight: 'auto' }}>
              <IconCheckmark size={12} /> Saved
            </Badge>
          )}
          <Button
            variant="secondary"
            onClick={handleReset}
            style={{ padding: '8px 20px', fontSize: 'var(--text-sm)', letterSpacing: '0.05em' }}
          >
            Reset to Defaults
          </Button>
          <Button
            variant="primary"
            onClick={handleSaveToServer}
            disabled={saving}
            style={{
              background: saving ? 'rgba(255,99,71,0.5)' : 'var(--color-tomato)',
              cursor: saving ? 'wait' : 'pointer',
              padding: '8px 24px',
              fontSize: 'var(--text-sm)',
              letterSpacing: '0.05em',
            }}
          >
            {saving ? 'Saving...' : 'Save to Server'}
          </Button>
        </div>
      </div>
    </div>
  );
}
