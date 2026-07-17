export interface ScreenControlProbeTarget {
  url: string;
  anonKey: string;
  serviceKey: string;
  projectRef: string;
}

export function assertScreenControlProbeTarget(env: NodeJS.ProcessEnv): ScreenControlProbeTarget {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  if (env.SCREEN_CONTROL_INTEGRATION !== 'true') {
    throw new Error('SCREEN_CONTROL_INTEGRATION=true is required');
  }
  const url = required('SUPABASE_URL');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const projectRef = required('SUPABASE_PROJECT_REF');
  const testRef = required('SCREEN_CONTROL_TEST_PROJECT_REF');
  const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF');
  const confirm = required('SCREEN_CONTROL_INTEGRATION_CONFIRM');
  const hostRef = new URL(url).hostname.split('.')[0];
  if (projectRef !== testRef || projectRef !== hostRef) throw new Error('Hosted probe project-ref guard failed');
  if (projectRef === productionRef) throw new Error('Hosted probe refuses the production project');
  if (confirm !== `nonprod:${projectRef}`) throw new Error('Hosted probe confirmation guard failed');
  return { url, anonKey, serviceKey, projectRef };
}
