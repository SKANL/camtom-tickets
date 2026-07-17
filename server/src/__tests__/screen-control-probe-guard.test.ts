import { describe, expect, it } from 'vitest';
import { assertScreenControlProbeTarget } from '../screen-control-probe-guard';

const valid = {
  SCREEN_CONTROL_INTEGRATION: 'true',
  SUPABASE_URL: 'https://staging-ref.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_PROJECT_REF: 'staging-ref',
  SCREEN_CONTROL_TEST_PROJECT_REF: 'staging-ref',
  SUPABASE_PRODUCTION_PROJECT_REF: 'production-ref',
  SCREEN_CONTROL_INTEGRATION_CONFIRM: 'nonprod:staging-ref',
};

describe('hosted screen-control probe guard', () => {
  it('accepts only an explicitly confirmed non-production ref matching the URL', () => {
    expect(assertScreenControlProbeTarget(valid)).toMatchObject({ projectRef: 'staging-ref' });
  });

  it('refuses production, ref mismatch, and missing opt-in', () => {
    expect(() => assertScreenControlProbeTarget({ ...valid, SUPABASE_PRODUCTION_PROJECT_REF: 'staging-ref' })).toThrow(/refuses the production/);
    expect(() => assertScreenControlProbeTarget({ ...valid, SCREEN_CONTROL_TEST_PROJECT_REF: 'other-ref' })).toThrow(/project-ref guard/);
    expect(() => assertScreenControlProbeTarget({ ...valid, SCREEN_CONTROL_INTEGRATION: 'false' })).toThrow(/SCREEN_CONTROL_INTEGRATION=true/);
    expect(() => assertScreenControlProbeTarget({ ...valid, SCREEN_CONTROL_INTEGRATION_CONFIRM: 'yes' })).toThrow(/confirmation guard/);
  });
});
