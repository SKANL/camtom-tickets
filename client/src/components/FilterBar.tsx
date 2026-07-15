import React, { useState, useCallback } from 'react';
import { MetadataCatalog, FilterState } from '@camtom/shared';
import { IconSearch, IconX, IconCheckmark } from './Icons';
import { PRIORITY_OPTIONS } from '../lib/priorities';

interface FilterBarProps {
  metadata: MetadataCatalog | null;
  filter: FilterState;
  onChange: (filter: FilterState) => void;
}

function emptyFilter(): FilterState {
  return {
    projects: [],
    assignees: [],
    states: [],
    labels: [],
    priorities: [],
    textSearch: '',
    excludeStates: [],
  };
}

function countActive(f: FilterState): number {
  let count = 0;
  if (f.projects.length > 0) count++;
  if (f.assignees.length > 0) count++;
  if (f.states.length > 0) count++;
  if (f.labels.length > 0) count++;
  if (f.priorities.length > 0) count++;
  if (f.textSearch.trim().length > 0) count++;
  // excludeStates is not counted — it's an invisible default, not user-facing
  return count;
}

type FilterKey = keyof FilterState;

export function FilterBar({ metadata, filter, onChange }: FilterBarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = countActive(filter);

  const setFilter = useCallback(<K extends FilterKey>(key: K, value: FilterState[K]) => {
    onChange({ ...filter, [key]: value });
  }, [filter, onChange]);

  const toggleArray = useCallback((key: 'projects' | 'assignees' | 'states' | 'labels' | 'priorities', id: string) => {
    const current = filter[key] as string[];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setFilter(key, next);
  }, [filter, setFilter]);

  const clearAll = useCallback(() => {
    onChange(emptyFilter());
  }, [onChange]);

  const disabled = !metadata;

  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: collapsed ? '4px var(--space-lg)' : 'var(--space-sm) var(--space-lg)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          background: collapsed && activeCount > 0 ? 'var(--color-tomato)' : 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 'var(--radius-pill)',
          padding: '4px 12px',
          cursor: 'pointer',
          color: collapsed && activeCount > 0 ? '#fff' : 'rgba(255,255,255,0.6)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xs)',
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        Filtros
        {activeCount > 0 && (
          <span
            style={{
              background: collapsed ? 'rgba(255,255,255,0.3)' : 'var(--color-tomato)',
              color: '#fff',
              borderRadius: '50%',
              width: 18,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {activeCount}
          </span>
        )}
      </button>

      {!collapsed && (
        <>
          {/* Text search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IconSearch size={14} style={{ position: 'absolute', left: 8, color: 'rgba(255,255,255,0.3)' }} />
            <input
              placeholder="Buscar tickets..."
              value={filter.textSearch}
              onChange={(e) => setFilter('textSearch', e.target.value)}
              disabled={disabled}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-pill)',
                padding: '4px 12px 4px 28px',
                color: 'var(--color-mayo)',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-xs)',
                width: 150,
                outline: 'none',
              }}
            />
          </div>

          {/* Status select */}
          <FilterSelect
            label="Estado"
            options={metadata?.workflowStates ?? []}
            selected={filter.states}
            onChange={(id) => toggleArray('states', id)}
            disabled={disabled}
          />

          {/* Assignee select */}
          <FilterSelect
            label="Responsable"
            options={metadata?.users ?? []}
            selected={filter.assignees}
            onChange={(id) => toggleArray('assignees', id)}
            disabled={disabled}
          />

          {/* Label select */}
          <FilterSelect
            label="Etiqueta"
            options={metadata?.labels ?? []}
            selected={filter.labels}
            onChange={(id) => toggleArray('labels', id)}
            disabled={disabled}
          />

          {/* Project select */}
          <FilterSelect
            label="Proyecto"
            options={metadata?.projects ?? []}
            selected={filter.projects}
            onChange={(id) => toggleArray('projects', id)}
            disabled={disabled}
          />

          {/* Priority select */}
          <FilterSelect
            label="Prioridad"
            options={PRIORITY_OPTIONS}
            selected={filter.priorities.map(String)}
            onChange={(id) => toggleArray('priorities', id)}
            disabled={disabled}
            stringIds
          />

          {/* Separator */}
          {activeCount > 0 && (
            <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
          )}

          {/* Clear all */}
          {activeCount > 0 && (
            <button
              onClick={clearAll}
              title="Limpiar todos los filtros"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-pill)',
                color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-xs)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
            >
              <IconX size={14} /> Limpiar
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---- Filter Select Component ----

interface FilterSelectProps {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (id: string) => void;
  disabled?: boolean;
  stringIds?: boolean;
}

function FilterSelect({ label, options, selected, onChange, disabled, stringIds }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const activeCount = selected.length;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        style={{
          background: activeCount > 0 ? 'rgba(255,99,71,0.15)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${activeCount > 0 ? 'rgba(255,99,71,0.3)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 'var(--radius-pill)',
          padding: '4px 12px',
          cursor: disabled ? 'default' : 'pointer',
          color: activeCount > 0 ? 'var(--color-tomato)' : 'rgba(255,255,255,0.6)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xs)',
          letterSpacing: '0.05em',
          opacity: disabled ? 0.4 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
        {activeCount > 0 && (
          <span style={{
            background: 'var(--color-tomato)',
            color: '#fff',
            borderRadius: '50%',
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
          }}>
            {activeCount}
          </span>
        )}
      </button>

      {open && !disabled && (
        <>
          {/* Backdrop to close */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 1000,
              background: '#2C1810',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 'var(--radius-sm)',
              padding: 4,
              minWidth: 160,
              maxHeight: 200,
              overflow: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              marginTop: 4,
            }}
          >
            {options.length === 0 && (
              <div style={{ padding: 8, color: 'rgba(255,255,255,0.4)', fontSize: 'var(--text-xs)' }}>
                Sin opciones
              </div>
            )}
            {options.map((opt) => {
              const isSelected = selected.includes(opt.id);
              return (
                <div
                  key={opt.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => onChange(opt.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onChange(opt.id);
                    }
                  }}
                  style={{
                    padding: '6px 10px',
                    cursor: 'pointer',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: isSelected ? 'rgba(255,99,71,0.15)' : 'transparent',
                    color: isSelected ? 'var(--color-tomato)' : 'var(--color-mayo)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--text-xs)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? 'rgba(255,99,71,0.15)' : 'transparent'; }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      border: `2px solid ${isSelected ? 'var(--color-tomato)' : 'rgba(255,255,255,0.2)'}`,
                      background: isSelected ? 'var(--color-tomato)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {isSelected && <IconCheckmark size={10} style={{ color: '#fff' }} />}
                  </span>
                  {opt.name}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
