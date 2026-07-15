import React from 'react';
import { Issue, TimerInfo, ConfigResponse } from '@camtom/shared';
import { PriorityGroup } from './PriorityGroup';
import { Skeleton } from 'boneyard-js/react';
import { priorityIcons } from './Icons';

interface DashboardProps {
  issues: Issue[];
  timers: Map<string, TimerInfo>;
  loading: boolean;
  config: ConfigResponse | null;
}

interface PriorityBucket {
  label: string;
  icon: React.ReactNode;
  color: string;
  priority: number;
  issues: Issue[];
}

function LoadingSkeleton() {
  return (
    <div className="order-column">
      <div className="chef-section-header" style={{ color: 'var(--color-mayo)' }}>
        <Skeleton name="priority-header" loading>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-card)' }} />
            <div style={{ width: 100, height: 28, borderRadius: 4, background: 'var(--bg-card)' }} />
          </div>
        </Skeleton>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} name={`ticket-${i}`} loading>
            <div style={{ height: 180, background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '2px dashed rgba(255,255,255,0.08)' }} />
          </Skeleton>
        ))}
      </div>
    </div>
  );
}

export function Dashboard({ issues, timers, loading, config }: DashboardProps) {
  const displayOrder = config?.dashboard?.displayOrder ?? [1, 2, 3, 4, 0];
  const priorityLabels = config?.dashboard?.priorityLabels ?? {};
  const { columnOrder, columnVisibility } = config?.dashboard?.displayOptions ?? {};

  const order = columnOrder && columnOrder.length > 0 ? columnOrder : displayOrder;

  const buckets: PriorityBucket[] = order
    .filter((p) => priorityLabels[p])
    .filter((p) => columnVisibility?.[p] !== false) // hidden only when explicitly false
    .map((priority) => {
      const pl = priorityLabels[priority];
      const IconComp = priorityIcons[priority];
      return {
        label: pl.label,
        icon: IconComp ? <IconComp size={22} /> : null,
        color: pl.color,
        priority,
        issues: issues.filter((i) => i.priority === priority),
      };
    });

  if (loading && issues.length === 0) {
    return (
      <div className="order-board">
        {buckets.map((bucket) => (
          <LoadingSkeleton key={bucket.priority} />
        ))}
      </div>
    );
  }

  return (
    <div className="order-board">
      {buckets.map((bucket) => (
        <PriorityGroup
          key={bucket.priority}
          label={bucket.label}
          icon={bucket.icon}
          color={bucket.color}
          issues={bucket.issues}
          timers={timers}
          collapsed={bucket.issues.length === 0}
          config={config}
        />
      ))}
    </div>
  );
}
