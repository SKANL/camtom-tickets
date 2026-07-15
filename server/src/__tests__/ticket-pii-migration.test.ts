import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('ticket PII migration', () => {
  it('redacts existing rows and enforces redaction on future writes', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/0005_redact_ticket_pii.sql'),
      'utf8',
    );

    expect(sql).toContain('new.description := null');
    expect(sql).toMatch(/jsonb_build_object\(\s*'id', new\.assignee -> 'id',\s*'name', new\.assignee -> 'name'\s*\)/);
    expect(sql).toContain('set search_path = pg_catalog');
    expect(sql).toContain('revoke all on function public.redact_ticket_pii() from public');
    expect(sql).toContain('before insert or update on public.tickets');
    expect(sql).toContain('update public.tickets');
    expect(sql).toMatch(/assignee is not null\s+and assignee is distinct from jsonb_build_object/);
    expect(sql).not.toContain("assignee ? 'email'");
  });
});
