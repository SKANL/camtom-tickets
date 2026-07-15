-- Add the real resolution timestamp so the Friday report stops using updated_at
-- (which bumps on any edit) as a proxy for "when the ticket was completed".
alter table public.tickets add column if not exists completed_at timestamptz;
