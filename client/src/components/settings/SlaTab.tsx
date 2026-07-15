import React from 'react';
import { SLAConfig } from '@camtom/shared';
import { PRIORITY_BY_LEVEL } from '../../lib/priorities';
import { IconPlus } from '../Icons';
import { inputStyle } from './layout';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

interface SlaTabProps {
  slaRules: SLAConfig[];
  editingSla: SLAConfig | null;
  slaValidation: string | null;
  handleAddSla: () => void;
  handleRemoveSla: (id: string) => void;
  handleSaveSla: (sla: SLAConfig) => void;
  toggleSlaPriority: (sla: SLAConfig, priority: number) => void;
  setEditingSla: (sla: SLAConfig | null) => void;
}

const TIER_LABELS: Record<'warming' | 'heating' | 'critical', string> = {
  warming: 'tibio',
  heating: 'caliente',
  critical: 'crítico',
};

export function SlaTab({
  slaRules,
  editingSla,
  slaValidation,
  handleAddSla,
  handleRemoveSla,
  handleSaveSla,
  toggleSlaPriority,
  setEditingSla,
}: SlaTabProps) {
  return (
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
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', minWidth: 40 }}>Etiqueta</span>
                <input
                  value={editingSla.label}
                  onChange={(e) => setEditingSla({ ...editingSla, label: e.target.value })}
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', minWidth: 40 }}>Minutos</span>
                <input
                  type="number"
                  min={1}
                  value={editingSla.maxMinutes}
                  onChange={(e) => setEditingSla({ ...editingSla, maxMinutes: Math.max(1, Number(e.target.value)) })}
                  style={{ ...inputStyle, width: 80 }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', minWidth: 40 }}>Umbrales</span>
                {(['warming', 'heating', 'critical'] as const).map((tier) => (
                  <label key={tier} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.6)' }}>
                    {TIER_LABELS[tier]}
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
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-xs)', display: 'block', marginBottom: 4 }}>Prioridades aplicables</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 0].map((p) => (
                    <Button
                      key={p}
                      variant="pill"
                      active={editingSla.applicablePriorities.includes(p)}
                      onClick={() => toggleSlaPriority(editingSla, p)}
                    >
                      {PRIORITY_BY_LEVEL[p].name}
                    </Button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <Button
                  variant="secondary"
                  onClick={() => setEditingSla(null)}
                  style={{ padding: '4px 12px', fontSize: 'var(--text-xs)' }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleSaveSla(editingSla)}
                  style={{ padding: '4px 12px', fontSize: 'var(--text-xs)' }}
                >
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--color-mayo)' }}>
                {sla.label}
              </span>
              <Badge>{sla.maxMinutes}min</Badge>
              <Badge>P{sla.applicablePriorities.sort().join(',P')}</Badge>
              <Button
                variant="neutral"
                onClick={() => setEditingSla(sla)}
                style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
              >
                Editar
              </Button>
              <Button
                variant="danger"
                onClick={() => handleRemoveSla(sla.id)}
                style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
              >
                Quitar
              </Button>
            </div>
          )}
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={handleAddSla}
        style={{
          border: '1px dashed rgba(255,255,255,0.2)',
          color: 'rgba(255,255,255,0.5)',
          padding: '8px',
          fontSize: 'var(--text-sm)',
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <IconPlus size={14} /> Agregar regla SLA
      </Button>
    </div>
  );
}
