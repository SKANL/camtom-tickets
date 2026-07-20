import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigResponse, Issue, TimerInfo } from '@camtom/shared';
import { Skeleton } from 'boneyard-js/react';
import { TicketCard } from './TicketCard';
import { EmptyKitchen } from './EmptyKitchen';
import { zoneForIssue } from '../lib/board';
import { IconCheckmark, IconEdit, IconForkKnife } from './Icons';

interface DashboardProps {
  issues: Issue[];
  /** Complete sync snapshot; arrival memory must not depend on filters or team visibility. */
  issueUniverse?: Issue[];
  doneToday: Issue[];
  timers: Map<string, TimerInfo>;
  loading: boolean;
  error: string | null;
  config: ConfigResponse | null;
  presentationMode?: boolean;
  compactPresentation?: boolean;
  rotation?: { enabled: boolean; intervalSeconds: number; paused: boolean };
  presentationCommand?: { id: string; type: 'next' | 'previous' | 'restartRotation' };
  onPresentationCommandHandled?: (commandId: string) => void;
}

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
      <span className="zone-header__icon">{icon}</span>
      <h2>{title}</h2>
      <span className="kitchen-badge" style={color ? { background: color } : undefined}>{count}</span>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="zone-grid" aria-label="Cargando órdenes">
      {[1, 2, 3, 4].map((index) => (
        <Skeleton key={index} name={`ticket-${index}`} loading>
          <div className="ticket-skeleton" />
        </Skeleton>
      ))}
    </div>
  );
}

const DEFAULT_ZONE_LABELS = { new: 'Sin tomar', active: 'En progreso', done: 'Servidos hoy' };
const DEFAULT_ROTATION = { enabled: true, intervalSeconds: 12, paused: false };
export const SEEN_ISSUE_HISTORY_LIMIT = 2_000;

export function rememberIssueUniverse(
  history: Map<string, number>,
  currentIds: readonly string[],
  sequence: number,
): number {
  const current = new Set(currentIds);
  for (const id of currentIds) {
    history.delete(id);
    history.set(id, sequence++);
  }
  const maximum = Math.max(SEEN_ISSUE_HISTORY_LIMIT, current.size);
  if (history.size > maximum) {
    for (const id of history.keys()) {
      if (history.size <= maximum) break;
      if (!current.has(id)) history.delete(id);
    }
  }
  return sequence;
}

export function Dashboard({
  issues,
  issueUniverse = issues,
  doneToday,
  timers,
  loading,
  error,
  config,
  presentationMode = false,
  compactPresentation = false,
  rotation = DEFAULT_ROTATION,
  presentationCommand,
  onPresentationCommandHandled,
}: DashboardProps) {
  const displayOptions = config?.dashboard.displayOptions;
  const order = config?.dashboard.displayOrder?.length
    ? config.dashboard.displayOrder
    : displayOptions?.columnOrder?.length
      ? displayOptions.columnOrder
      : [1, 2, 3, 4, 0];
  const orderKey = order.join('|');
  const visibleIssues = useMemo(
    () => issues.filter((issue) => displayOptions?.columnVisibility?.[issue.priority] !== false),
    [issues, displayOptions?.columnVisibility],
  );
  const sort = useMemo(() => {
    const urgency = byUrgency(timers);
    const rank = new Map(order.map((priority, index) => [priority, index]));
    return (a: Issue, b: Issue) => {
      const priorityDelta = (rank.get(a.priority) ?? 99) - (rank.get(b.priority) ?? 99);
      return priorityDelta || urgency(a, b);
    };
  }, [timers, orderKey]);

  const newOnes = visibleIssues.filter((issue) => zoneForIssue(issue) === 'new').sort(sort);
  const active = visibleIssues.filter((issue) => zoneForIssue(issue) === 'active').sort(sort);
  const seenIssueIds = useRef<Map<string, number> | null>(null);
  const seenSequence = useRef(0);
  const arrivalTimeout = useRef<number | null>(null);
  const [newIssueIds, setNewIssueIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentUniverse = new Set(issueUniverse.map((issue) => issue.id));
    if (seenIssueIds.current === null) {
      seenIssueIds.current = new Map(issueUniverse.map((issue) => [issue.id, seenSequence.current++]));
      return undefined;
    }
    const arrivals = visibleIssues
      .filter((issue) => !seenIssueIds.current!.has(issue.id))
      .map((issue) => issue.id);
    seenSequence.current = rememberIssueUniverse(
      seenIssueIds.current,
      issueUniverse.map((issue) => issue.id),
      seenSequence.current,
    );
    if (!arrivals.length) return undefined;
    setNewIssueIds((current) => new Set([...current, ...arrivals]));
    if (arrivalTimeout.current !== null) window.clearTimeout(arrivalTimeout.current);
    arrivalTimeout.current = window.setTimeout(() => {
      arrivalTimeout.current = null;
      setNewIssueIds(new Set());
    }, 2_500);
    return undefined;
  }, [issueUniverse, visibleIssues]);

  useEffect(() => () => {
    if (arrivalTimeout.current !== null) window.clearTimeout(arrivalTimeout.current);
  }, []);

  const pageSize = compactPresentation ? 2 : 4;
  const totalPages = presentationMode
    ? Math.max(1, Math.ceil(newOnes.length / pageSize), Math.ceil(active.length / pageSize))
    : 1;
  const [page, setPage] = useState(0);
  const lastCommandId = useRef<string | null>(null);
  const handledCommandId = useRef<string | null>(null);
  const [committedCommandId, setCommittedCommandId] = useState<string | null>(null);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  useEffect(() => {
    if (!presentationMode || !rotation.enabled || rotation.paused || totalPages <= 1) return undefined;
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % totalPages),
      Math.max(5, rotation.intervalSeconds || 12) * 1_000,
    );
    return () => window.clearInterval(timer);
  }, [presentationMode, rotation.enabled, rotation.paused, rotation.intervalSeconds, totalPages,
    presentationCommand?.type === 'restartRotation' ? presentationCommand.id : undefined]);

  useEffect(() => {
    if (!presentationMode || !presentationCommand || lastCommandId.current === presentationCommand.id) return;
    lastCommandId.current = presentationCommand.id;
    setPage((current) => {
      if (presentationCommand.type === 'next') return (current + 1) % totalPages;
      if (presentationCommand.type === 'previous') return (current - 1 + totalPages) % totalPages;
      return 0;
    });
    setCommittedCommandId(presentationCommand.id);
  }, [presentationCommand, presentationMode, totalPages]);

  useEffect(() => {
    if (!committedCommandId || handledCommandId.current === committedCommandId
      || !onPresentationCommandHandled) return;
    handledCommandId.current = committedCommandId;
    onPresentationCommandHandled(committedCommandId);
  }, [committedCommandId, onPresentationCommandHandled]);

  const pageItems = (items: Issue[]) => {
    if (!presentationMode || items.length <= pageSize) return items;
    const zonePages = Math.ceil(items.length / pageSize);
    const zonePage = page % zonePages;
    return items.slice(zonePage * pageSize, (zonePage + 1) * pageSize);
  };
  const pagedNew = pageItems(newOnes);
  const pagedActive = pageItems(active);
  const zones = { ...DEFAULT_ZONE_LABELS, ...config?.dashboard?.zoneLabels };
  const phrases = config?.dashboard?.kitchenPhrases;
  const initialLoad = loading && issues.length === 0 && doneToday.length === 0;

  return (
    <div className={`board ${compactPresentation ? 'board--compact-presentation' : ''}`}>
      {presentationMode && totalPages > 1 && (
        <div className="board-rotation-status" role="status" aria-label={`Página ${page + 1} de ${totalPages}`}>
          <span>Órdenes {page + 1}/{totalPages}</span>
          <span className="board-rotation-dots" aria-hidden="true">
            {Array.from({ length: totalPages }, (_, index) => <span key={index} className={index === page ? 'active' : ''} />)}
          </span>
          {rotation.paused && <span>Pausado</span>}
        </div>
      )}

      <section className="zone zone-new">
        <ZoneHeader icon={<IconEdit size={22} />} title={zones.new} count={newOnes.length} color="var(--color-mustard)" />
        {initialLoad ? <SkeletonGrid /> : newOnes.length > 0 ? (
          <div className="zone-grid zone-scroll">
            {pagedNew.map((issue) => (
              <TicketCard key={issue.id} issue={issue} timer={timers.get(issue.id)} config={config} variant="hero" isNew={newIssueIds.has(issue.id)} />
            ))}
          </div>
        ) : <EmptyKitchen variant={error ? 'error' : 'idle'} phrases={phrases} servedToday={doneToday.length} />}
      </section>

      {active.length > 0 && (
        <section className="zone zone-active">
          <ZoneHeader icon={<IconForkKnife size={18} />} title={zones.active} count={active.length} color="var(--color-oil)" />
          <div className="zone-grid zone-grid-compact zone-scroll">
            {pagedActive.map((issue) => (
              <TicketCard key={issue.id} issue={issue} timer={timers.get(issue.id)} config={config} variant="compact" isNew={newIssueIds.has(issue.id)} />
            ))}
          </div>
        </section>
      )}

      {doneToday.length > 0 && (
        <section className="zone zone-done">
          <div className="done-shelf">
            <span className="done-shelf-title"><IconCheckmark size={16} /> {zones.done} · {doneToday.length}</span>
            <div className="done-chips">
              {doneToday.map((issue) => (
                <span key={issue.id} className="done-chip" title={issue.title}><IconCheckmark size={12} /> {issue.identifier}</span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
