import React from 'react';
import { Issue, TimerInfo, ConfigResponse } from '@camtom/shared';
import { TicketCard } from './TicketCard';
import { EmptyKitchen } from './EmptyKitchen';
import { Skeleton } from 'boneyard-js/react';
import { zoneForIssue } from '../lib/board';
import { IconEdit, IconForkKnife, IconCheckmark } from './Icons';

interface DashboardProps {
  issues: Issue[]; // active tickets (already filtered): untaken + in-progress
  doneToday: Issue[]; // completed today (computed from the unfiltered set)
  timers: Map<string, TimerInfo>;
  loading: boolean;
  error: string | null;
  config: ConfigResponse | null;
}

/** Hottest first: tickets with a running timer sorted by time remaining, then the rest. */
function byUrgency(timers: Map<string, TimerInfo>) {
  return (a: Issue, b: Issue) => {
    const ta = timers.get(a.id);
    const tb = timers.get(b.id);
    if (ta && tb) return ta.remaining - tb.remaining;
    if (ta) return -1;
    if (tb) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  };
}

function ZoneHeader({ icon, title, count, color }: { icon: React.ReactNode; title: string; count: number; color?: string }) {
  return (
    <div className="chef-section-header zone-header" style={color ? { color } : undefined}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', letterSpacing: '0.05em', margin: 0, lineHeight: 1 }}>{title}</h2>
      <span className="kitchen-badge" style={color ? { background: color } : { background: 'var(--bg-card-hover)' }}>{count}</span>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="zone-grid">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} name={`ticket-${i}`} loading>
          <div style={{ height: 180, background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '2px dashed rgba(255,255,255,0.08)' }} />
        </Skeleton>
      ))}
    </div>
  );
}

const DEFAULT_ZONE_LABELS = { new: 'Sin tomar', active: 'En progreso', done: 'Servidos hoy' };

export function Dashboard({ issues, doneToday, timers, loading, error, config }: DashboardProps) {
  const sort = byUrgency(timers);
  const newOnes = issues.filter((i) => zoneForIssue(i) === 'new').sort(sort);
  const active = issues.filter((i) => zoneForIssue(i) === 'active').sort(sort);

  const zones = { ...DEFAULT_ZONE_LABELS, ...config?.dashboard?.zoneLabels };
  const phrases = config?.dashboard?.kitchenPhrases;
  const initialLoad = loading && issues.length === 0 && doneToday.length === 0;

  return (
    <div className="board">
      {/* HERO — untaken tickets, the thing the TV should scream about */}
      <section className="zone zone-new">
        <ZoneHeader icon={<IconEdit size={22} />} title={zones.new} count={newOnes.length} color="var(--color-mustard)" />
        {initialLoad ? (
          <SkeletonGrid />
        ) : newOnes.length > 0 ? (
          <div className="zone-grid zone-scroll">
            {newOnes.map((issue) => (
              <TicketCard key={issue.id} issue={issue} timer={timers.get(issue.id)} config={config} variant="hero" />
            ))}
          </div>
        ) : (
          <EmptyKitchen
            variant={error ? 'error' : 'idle'}
            phrases={phrases}
            servedToday={doneToday.length}
          />
        )}
      </section>

      {/* IN PROGRESS — compact strip, someone's on it */}
      {active.length > 0 && (
        <section className="zone zone-active">
          <ZoneHeader icon={<IconForkKnife size={18} />} title={zones.active} count={active.length} color="var(--color-oil)" />
          <div className="zone-grid zone-grid-compact zone-scroll">
            {active.map((issue) => (
              <TicketCard key={issue.id} issue={issue} timer={timers.get(issue.id)} config={config} variant="compact" />
            ))}
          </div>
        </section>
      )}

      {/* SERVED TODAY — the trophy shelf that fills up during the day */}
      {doneToday.length > 0 && (
        <section className="zone zone-done">
          <div className="done-shelf">
            <span className="done-shelf-title">
              <IconCheckmark size={16} /> {zones.done} · {doneToday.length}
            </span>
            <div className="done-chips">
              {doneToday.map((issue) => (
                <span key={issue.id} className="done-chip" title={issue.title}>
                  <IconCheckmark size={12} /> {issue.identifier}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
