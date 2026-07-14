import { Issue } from '@camtom/shared';
import { issuesCache } from './cache';
import { fetchAllIssues } from './linear-client';
import { getConfig } from './config';
import { sseManager } from './sse';

let pollTimer: NodeJS.Timeout | null = null;
let previousIssues: Map<string, Issue> = new Map();
let isPolling = false;

// ---- AssignmentTracker ----
class AssignmentTracker {
  private timestamps: Map<string, number> = new Map(); // issueId → epoch ms

  /** Store the assignment timestamp.
   *  Prefer Linear's assignedAt when available, fall back to server time. */
  stamp(issueId: string, assignedAt?: string): void {
    const epoch = assignedAt ? new Date(assignedAt).getTime() : Date.now();
    this.timestamps.set(issueId, epoch);
  }

  stampAll(issues: Issue[]): void {
    for (const issue of issues) {
      const epoch = issue.assignedAt
        ? new Date(issue.assignedAt).getTime()
        : Date.now();
      this.timestamps.set(issue.id, epoch);
    }
  }

  getTimestamps(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, epoch] of this.timestamps) {
      result[id] = new Date(epoch).toISOString();
    }
    return result;
  }

  /** Detect assignee change between prev and current issue.
   *  Uses Linear's assignedAt as primary source when available. */
  onAssigneeChange(prev: Issue | null, current: Issue): string | null {
    if (!prev) return null;
    const prevId = prev.assignee?.id ?? null;
    const currId = current.assignee?.id ?? null;
    if (prevId !== currId) {
      this.stamp(current.id, current.assignedAt);
      return current.id;
    }
    return null;
  }

  clear(): void {
    this.timestamps.clear();
  }
}

const assignmentTracker = new AssignmentTracker();

function computeDiff(current: Issue[]): {
  added: Issue[];
  updated: Issue[];
  removed: string[];
} {
  const currentMap = new Map(current.map((i) => [i.id, i]));
  const added: Issue[] = [];
  const updated: Issue[] = [];
  const removed: string[] = [];

  // Find added and updated
  for (const [id, issue] of currentMap) {
    const prev = previousIssues.get(id);
    if (!prev) {
      added.push(issue);
      // Stamp new issues on add — prefer Linear's assignedAt
      assignmentTracker.stamp(id, issue.assignedAt);
    } else if (prev.updatedAt !== issue.updatedAt) {
      updated.push(issue);
      // Check for assignee change within updated
      assignmentTracker.onAssigneeChange(prev, issue);
    }
  }

  // Find removed
  for (const [id] of previousIssues) {
    if (!currentMap.has(id)) {
      removed.push(id);
    }
  }

  return { added, updated, removed };
}

function isSignificantChange(diff: {
  added: Issue[];
  updated: Issue[];
  removed: string[];
}): boolean {
  return diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
}

function isFirstPoll(): boolean {
  return previousIssues.size === 0;
}

export async function pollOnce(): Promise<void> {
  if (isPolling) {
    console.log('[poller] Previous poll still in progress, skipping');
    return;
  }

  isPolling = true;
  try {
    const issues = await fetchAllIssues();
    issuesCache.set('issues', issues);

    const firstPoll = isFirstPoll();

    const diff = computeDiff(issues);
    previousIssues = new Map(issues.map((i) => [i.id, i]));

    // Stamp all current issues as now on initial poll (restart recovery)
    if (firstPoll) {
      assignmentTracker.stampAll(issues);
    }

    const assignmentTimestamps = assignmentTracker.getTimestamps();

    if (isSignificantChange(diff) || firstPoll) {
      console.log(
        `[poller] Broadcasting delta: +${diff.added.length} ~${diff.updated.length} -${diff.removed.length}`,
      );
      sseManager.broadcastDelta({
        ...diff,
        serverTime: Date.now(),
        assignmentTimestamps,
      });
    }
  } catch (err: any) {
    console.error(`[poller] Poll failed: ${err.message}`);
  } finally {
    isPolling = false;
  }
}

export function startPolling(): void {
  const config = getConfig();
  const interval = config.dashboard.pollingInterval;

  console.log(`[poller] Starting polling every ${interval}ms`);
  sseManager.startHeartbeat();

  // Do initial poll immediately
  pollOnce().catch((err) =>
    console.error(`[poller] Initial poll failed: ${err.message}`),
  );

  pollTimer = setInterval(() => {
    pollOnce().catch((err) =>
      console.error(`[poller] Scheduled poll failed: ${err.message}`),
    );
  }, interval);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getCachedIssues(): Issue[] | null {
  return issuesCache.get('issues');
}

export function getAssignmentTimestamps(): Record<string, string> {
  return assignmentTracker.getTimestamps();
}
