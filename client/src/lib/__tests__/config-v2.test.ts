import { describe, expect, it } from 'vitest';
import {
  createConfigV2,
  materializeTeamConfig,
  resolveTeamSettings,
  validateConfigV2,
} from '@camtom/shared';
import { configFixture } from '../../test/config-fixture';

describe('config v2 compatibility and resolution', () => {
  it('backfills every team with the exact legacy behavior', () => {
    const config = configFixture();
    const v2 = createConfigV2(config);
    expect(v2.teams.a.teamMembers).toEqual(['Ana']);
    expect(v2.teams.a.slas).toEqual(config.slas);
    expect(v2.teams.b.filter).toBe('ticket-label');
    expect(v2.teams.b.timer).toBe(false);
    expect(validateConfigV2(v2, ['a', 'b'])).toEqual([]);
  });

  it('resolves team settings independently and materializes the legacy component contract', () => {
    const config = configFixture();
    config.configV2 = createConfigV2(config);
    config.configV2.teams.b = {
      ...config.configV2.teams.b,
      teamMembers: ['Bruno'],
      report: { enabled: true, slaWindowHours: 72 },
      kitchenPhrases: { ...config.configV2.teams.b.kitchenPhrases, emptyState: 'B empty' },
    };
    expect(resolveTeamSettings(config, 'a').teamMembers).toEqual(['Ana']);
    expect(resolveTeamSettings(config, 'b').teamMembers).toEqual(['Bruno']);
    const materialized = materializeTeamConfig(config, 'b');
    expect(materialized.dashboard.report.slaWindowHours).toBe(72);
    expect(materialized.dashboard.kitchenPhrases.emptyState).toBe('B empty');
  });

  it('fails closed with useful paths for malformed team config', () => {
    const v2 = createConfigV2(configFixture());
    (v2.teams.a as any).timer = 'yes';
    expect(validateConfigV2(v2, ['a', 'b'])).toContain('configV2.teams.a.timer must be boolean');
    expect(validateConfigV2(v2, ['a'])).toContain('configV2.teams must contain exactly the configured dashboard teams');
  });

  it('uses complete team rows as the only authority instead of duplicate inherited defaults', () => {
    const config = configFixture();
    const v2 = createConfigV2(config);
    expect(v2.global).toEqual({ title: config.dashboard.title, pollingInterval: config.dashboard.pollingInterval });
    (v2.global as any).defaults = v2.teams.a;
    expect(validateConfigV2(v2, ['a', 'b'])).toContain('configV2.global contains unknown fields');
  });

  it('materializes every v2-required field when valid legacy optional fields are absent', () => {
    const config = configFixture();
    delete config.dashboard.zoneLabels;
    delete config.dashboard.displayOptions;
    const v2 = createConfigV2(config);
    expect(v2.teams.a.zoneLabels).toEqual({ new: 'Sin tomar', active: 'En progreso', done: 'Servidos hoy' });
    expect(v2.teams.a.displayOptions).toEqual({ columnOrder: [1, 2, 3, 4, 0] });
    expect(validateConfigV2(v2, ['a', 'b'])).toEqual([]);
  });
});
