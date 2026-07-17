import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createConfigV2 } from '@camtom/shared';
import { createDefaultScreenState } from '../../hooks/useScreenState';
import {
  SettingsPanel,
  applyConfigV2Preview,
  buildConfigV2SaveBody,
  resolveConfigMergeConflict,
  threeWayMergeConfigV2,
} from '../SettingsPanel';
import { configFixture } from '../../test/config-fixture';

describe('settings v2 serialization', () => {
  it('serializes every team without moving screen state into server config', () => {
    const config = configFixture();
    const v2 = createConfigV2(config);
    v2.teams.b.teamMembers = ['Independent'];
    const body = buildConfigV2SaveBody(v2, config.version);
    expect(Object.keys(body.configV2.teams)).toEqual(['a', 'b']);
    expect(body.configV2.teams.b.teamMembers).toEqual(['Independent']);
    expect(body).not.toHaveProperty('screenState');
    expect(body.expectedVersion).toBe(config.version);
    expect(applyConfigV2Preview(config, v2).configV2).toBe(v2);
  });

  it('three-way merges non-overlapping local and remote changes per team and field', () => {
    const config = configFixture();
    const base = createConfigV2(config);
    const draft = createConfigV2(config);
    const latest = createConfigV2(config);
    draft.teams.a.teamMembers = ['Draft'];
    draft.teams.a.priorityLabels[1].label = 'Local label';
    latest.global.title = 'Latest title';
    latest.teams.b.teamMembers = ['Concurrent'];
    latest.teams.a.priorityLabels[1].color = 'remote-color';
    const result = threeWayMergeConfigV2(base, draft, latest);
    expect(result.conflicts).toEqual([]);
    expect(result.merged.global.title).toBe('Latest title');
    expect(result.merged.teams.a.teamMembers).toEqual(['Draft']);
    expect(result.merged.teams.b.teamMembers).toEqual(['Concurrent']);
    expect(result.merged.teams.a.priorityLabels[1]).toEqual(expect.objectContaining({
      label: 'Local label', color: 'remote-color',
    }));
  });

  it('requires explicit resolution when local and remote change the same path', () => {
    const config = configFixture();
    const base = createConfigV2(config);
    const draft = createConfigV2(config);
    const latest = createConfigV2(config);
    draft.teams.a.report.slaWindowHours = 48;
    latest.teams.a.report.slaWindowHours = 72;
    const result = threeWayMergeConfigV2(base, draft, latest);
    expect(result.conflicts.map((conflict) => conflict.path.join('.'))).toEqual([
      'teams.a.report.slaWindowHours',
    ]);
    expect(result.merged.teams.a.report.slaWindowHours).toBe(72);
    expect(resolveConfigMergeConflict(result.merged, result.conflicts[0], 'local')
      .teams.a.report.slaWindowHours).toBe(48);
  });

  it('discards an unsaved live preview when settings closes', () => {
    const config = configFixture();
    config.configV2 = createConfigV2(config);
    const onApplyConfig = vi.fn();
    const onClose = vi.fn();
    render(<SettingsPanel
      config={config}
      screenState={createDefaultScreenState(['a', 'b'], 'a')}
      onApplyConfig={onApplyConfig}
      onSavedConfig={vi.fn()}
      onScreenStateChange={vi.fn()}
      onClose={onClose}
    />);
    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: 'ticket-label' } });
    expect(onApplyConfig.mock.calls.at(-1)?.[0].configV2.teams.a.filter).toBe('ticket-label');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar configuración' }));
    expect(onApplyConfig.mock.calls.at(-1)?.[0]).toBe(config);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
