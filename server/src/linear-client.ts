import { Issue } from '@camtom/shared';

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

interface LinearApiError {
  message: string;
  extensions?: {
    code?: string;
    rateLimit?: {
      limit: number;
      remaining: number;
      resetAt: string;
    };
  };
}

interface LinearPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface LinearIssuesResponse {
  nodes: LinearIssueNode[];
  pageInfo: LinearPageInfo;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  completedAt?: string | null;
  dueDate?: string;
  assignee?: { id: string; name: string; email?: string } | null;
  state: { id: string; name: string; type: string };
  labels?: { nodes: { id: string; name: string; color?: string }[] };
  project?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
  cycle?: { id: string; name: string } | null;
  estimate?: number;
}

export type ReconcileIssue = Issue & { archivedAt?: string };

export interface IssuePage {
  nodes: ReconcileIssue[];
  pageInfo: LinearPageInfo;
}

export interface FullIssueSnapshot {
  issues: ReconcileIssue[];
  pages: number;
  upperBound: string;
}

const MAX_ISSUE_PAGES = 1_000;

function getApiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error('LINEAR_API_KEY environment variable is not set');
  }
  return key;
}

function getTeamId(): string {
  const id = process.env.LINEAR_TEAM_ID;
  if (!id) {
    throw new Error('LINEAR_TEAM_ID environment variable is not set');
  }
  return id;
}

async function executeGraphQL(
  query: string,
  variables: Record<string, any>,
  retries: number = MAX_RETRIES,
  deadlineAt?: number,
): Promise<any> {
  const apiKey = getApiKey();

  for (let attempt = 0; attempt <= retries; attempt++) {
    assertBeforeDeadline(deadlineAt);
    const controller = deadlineAt ? new AbortController() : undefined;
    const timeout = deadlineAt
      ? setTimeout(() => controller!.abort(), Math.max(1, deadlineAt - Date.now()))
      : undefined;
    try {
      const response = await fetch(LINEAR_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller?.signal,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_BACKOFF_MS * Math.pow(2, attempt);

        console.warn(
          `[linear-client] Rate limited (attempt ${attempt + 1}/${retries + 1}), waiting ${waitMs}ms...`,
        );

        if (attempt < retries) {
          await sleep(waitMs, deadlineAt);
          continue;
        }
      }

      // Track rate limit headers from every response
      updateRateLimit(response.headers);

      const body = await response.json();

      if (rateLimitState.remaining < rateLimitState.limit * 0.1) {
        console.warn(
          `[linear-client] Rate limit running low: ${rateLimitState.remaining}/${rateLimitState.limit}`,
        );
      }

      if (body.errors) {
        const isRateLimited = (body.errors as LinearApiError[]).some(
          (e) => e.extensions?.code === 'RATELIMITED',
        );

        if (isRateLimited && attempt < retries) {
          const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(
            `[linear-client] Rate limited by API (attempt ${attempt + 1}/${retries + 1}), waiting ${waitMs}ms...`,
          );
          await sleep(waitMs, deadlineAt);
          continue;
        }

        throw new Error(
          `Linear API error: ${body.errors.map((e: LinearApiError) => e.message).join(', ')}`,
        );
      }

      return body.data;
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('Linear reconcile deadline exceeded');
      if (attempt < retries && !err.message?.includes('API key') && !err.message?.includes('deadline')) {
        const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[linear-client] Request failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}, retrying in ${waitMs}ms...`,
        );
        await sleep(waitMs, deadlineAt);
        continue;
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error('Max retries exceeded for Linear API request');
}

function assertBeforeDeadline(deadlineAt?: number): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new Error('Linear reconcile deadline exceeded');
  }
}

function sleep(ms: number, deadlineAt?: number): Promise<void> {
  if (deadlineAt !== undefined && Date.now() + ms >= deadlineAt) {
    throw new Error('Linear reconcile deadline exceeded before retry');
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapIssue(node: LinearIssueNode): ReconcileIssue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? undefined,
    priority: node.priority as Issue['priority'],
    priorityLabel: node.priorityLabel,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    archivedAt: node.archivedAt ?? undefined,
    completedAt: node.completedAt ?? undefined,
    dueDate: node.dueDate ?? undefined,
    assignee: node.assignee
      ? { id: node.assignee.id, name: node.assignee.name, email: node.assignee.email }
      : null,
    state: {
      id: node.state.id,
      name: node.state.name,
      type: node.state.type,
    },
    labels: node.labels ?? undefined,
    project: node.project ?? null,
    team: node.team ?? null,
    cycle: node.cycle ?? null,
    estimate: node.estimate ?? undefined,
  };
}

export async function paginateIssuePages(
  loadPage: (cursor: string | null) => Promise<IssuePage>,
  maxPages = MAX_ISSUE_PAGES,
): Promise<{ issues: ReconcileIssue[]; pages: number }> {
  const issues: ReconcileIssue[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 1; page <= maxPages; page++) {
    const result = await loadPage(cursor);
    issues.push(...result.nodes);
    if (!result.pageInfo.hasNextPage) return { issues, pages: page };

    const nextCursor = result.pageInfo.endCursor;
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error('Linear pagination returned an invalid or repeated endCursor');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(`Linear pagination exceeded ${maxPages} pages`);
}

/**
 * Fetch issues updated since a given timestamp.
 *
 * @param since ISO timestamp string, or null to fetch all issues (cold start).
 * When null, fetches everything via pagination.
 * When set, only fetches issues where updatedAt >= since (1-2 pages max).
 */
export async function fetchIssuesSince(since: string | null): Promise<ReconcileIssue[]> {
  // No team filter: reconcile covers every team (the webhook already writes all
  // teams via allPublicTeams). The board selects the active team client-side.
  const filter: any = {};
  if (since) {
    filter.updatedAt = { gte: since };
  }

  const query = `
  query IssuesSince($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, includeArchived: true, orderBy: updatedAt, first: $first, after: $after) {
      nodes {
        id
        identifier
        title
        description
        priority
        priorityLabel
        createdAt
        updatedAt
        archivedAt
        completedAt
        dueDate
        assignee { id name email }
        state { id name type }
        labels { nodes { id name color } }
        project { id name }
        team { id name }
        cycle { id name }
        estimate
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const result = await paginateIssuePages(async (cursor) => {
    const data: { issues: LinearIssuesResponse } = await executeGraphQL(
      query,
      { filter, first: 250, after: cursor },
    );
    return { nodes: data.issues.nodes.map(mapIssue), pageInfo: data.issues.pageInfo };
  });
  return result.issues;
}

export async function fetchFullIssues(
  teamIds: string[],
  upperBound: string,
  deadlineAt?: number,
): Promise<FullIssueSnapshot> {
  if (teamIds.length === 0) throw new Error('Full reconcile requires at least one team id');
  const filter = {
    team: { id: { in: teamIds } },
    updatedAt: { lte: upperBound },
  };
  const query = `
  query FullIssues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, includeArchived: true, orderBy: updatedAt, first: $first, after: $after) {
      nodes {
        id identifier title description priority priorityLabel createdAt updatedAt archivedAt completedAt dueDate
        assignee { id name email }
        state { id name type }
        labels { nodes { id name color } }
        project { id name }
        team { id name }
        cycle { id name }
        estimate
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const result = await paginateIssuePages(async (cursor) => {
    const data: { issues: LinearIssuesResponse } = await executeGraphQL(
      query,
      { filter, first: 250, after: cursor },
      MAX_RETRIES,
      deadlineAt,
    );
    return { nodes: data.issues.nodes.map(mapIssue), pageInfo: data.issues.pageInfo };
  });

  return { ...result, upperBound };
}

// ---- Metadata GQL Queries ----

const TEAMS_QUERY = `
query Teams {
  teams {
    nodes { id name }
  }
}`;

const PROJECTS_QUERY = `
query Projects {
  projects {
    nodes { id name }
  }
}`;

const USERS_QUERY = `
query Users {
  users {
    nodes { id name email }
  }
}`;

const WORKFLOW_STATES_QUERY = `
query WorkflowStates {
  workflowStates {
    nodes { id name type }
  }
}`;

const LABELS_QUERY = `
query IssueLabels {
  issueLabels {
    nodes { id name color }
  }
}`;

const CYCLES_QUERY = `
query Cycles($teamId: ID!) {
  cycles(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id name completedAt }
  }
}`;

interface SelectOption {
  id: string;
  name: string;
}

export async function fetchTeams(): Promise<SelectOption[]> {
  const data = await executeGraphQL(TEAMS_QUERY, {});
  return data.teams.nodes.map((n: any) => ({ id: n.id, name: n.name }));
}

export async function fetchProjects(): Promise<SelectOption[]> {
  const data = await executeGraphQL(PROJECTS_QUERY, {});
  return data.projects.nodes.map((n: any) => ({ id: n.id, name: n.name }));
}

export async function fetchUsers(): Promise<SelectOption[]> {
  const data = await executeGraphQL(USERS_QUERY, {});
  return data.users.nodes.map((n: any) => ({ id: n.id, name: n.name }));
}

export async function fetchWorkflowStates(): Promise<SelectOption[]> {
  const data = await executeGraphQL(WORKFLOW_STATES_QUERY, {});
  return data.workflowStates.nodes.map((n: any) => ({ id: n.id, name: n.name }));
}

export async function fetchLabels(): Promise<SelectOption[]> {
  const data = await executeGraphQL(LABELS_QUERY, {});
  return data.issueLabels.nodes.map((n: any) => ({ id: n.id, name: n.name }));
}

export async function fetchCycles(): Promise<(SelectOption & { completedAt?: string })[]> {
  const teamId = getTeamId();
  const data = await executeGraphQL(CYCLES_QUERY, { teamId });
  return data.cycles.nodes.map((n: any) => ({ id: n.id, name: n.name, completedAt: n.completedAt ?? undefined }));
}

// ---- Label Auto-Provisioning ----

const ISSUE_LABEL_CREATE_MUTATION = `
mutation IssueLabelCreate($name: String!, $color: String) {
  issueLabelCreate(input: { name: $name, color: $color }) {
    success
    issueLabel {
      id
      name
      color
    }
  }
}`;

async function createLabel(name: string, color?: string): Promise<boolean> {
  const data = await executeGraphQL(ISSUE_LABEL_CREATE_MUTATION, { name, color: color ?? null });
  return data.issueLabelCreate.success === true;
}

export async function ensureLabel(name: string): Promise<boolean> {
  // 1. Check existing labels
  const existing = await fetchLabels();
  const match = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (match) {
    return true; // already exists
  }
  // 2. Create the label
  return await createLabel(name);
}

// ---- Rate Limit Tracking ----

interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
  lastChecked: number; // epoch ms
}

let rateLimitState: RateLimitState = {
  limit: 5000,
  remaining: 5000,
  resetAt: 0,
  lastChecked: 0,
};

/**
 * Update rate limit state from response headers.
 * Linear returns: X-RateLimit-Requests-Limit, X-RateLimit-Requests-Remaining,
 * X-RateLimit-Requests-Reset (UTC epoch ms).
 */
function updateRateLimit(headers: Headers): void {
  const limit = headers.get('x-ratelimit-requests-limit');
  const remaining = headers.get('x-ratelimit-requests-remaining');
  const reset = headers.get('x-ratelimit-requests-reset');

  if (limit) rateLimitState.limit = parseInt(limit, 10);
  if (remaining !== null) rateLimitState.remaining = parseInt(remaining, 10);
  if (reset) rateLimitState.resetAt = parseInt(reset, 10);
  rateLimitState.lastChecked = Date.now();
}

/** Get current rate limit state snapshot. */
export function getRateLimitState(): RateLimitState {
  return { ...rateLimitState };
}

// ---- Webhook Management ----

const WEBHOOKS_QUERY = `
query Webhooks {
  webhooks {
    nodes { id url enabled resourceTypes }
  }
}`;

const WEBHOOK_CREATE_MUTATION = `
mutation WebhookCreate($url: String!, $resourceTypes: [String!]!) {
  webhookCreate(input: { url: $url, allPublicTeams: true, resourceTypes: $resourceTypes }) {
    success
    webhook { id url enabled }
  }
}`;

interface WebhookInfo {
  id: string;
  url: string;
  enabled: boolean;
  resourceTypes: string[];
}

export async function listWebhooks(): Promise<WebhookInfo[]> {
  const data = await executeGraphQL(WEBHOOKS_QUERY, {});
  return data.webhooks.nodes.map((n: any) => ({
    id: n.id,
    url: n.url,
    enabled: n.enabled,
    resourceTypes: n.resourceTypes,
  }));
}

/**
 * Register a Linear webhook for Issue events.
 * Skips if a webhook for this URL already exists.
 */
export async function registerWebhook(url: string): Promise<boolean> {
  // Check existing webhooks to avoid duplicates
  const existing = await listWebhooks();
  const match = existing.find((w) => w.url === url && w.enabled);
  if (match) {
    console.log(`[linear-client] Webhook already exists for ${url} (id: ${match.id})`);
    return true;
  }

  console.log(`[linear-client] Registering webhook for ${url}...`);
  const data = await executeGraphQL(WEBHOOK_CREATE_MUTATION, {
    url,
    resourceTypes: ['Issue'],
  });

  if (data.webhookCreate.success) {
    console.log(`[linear-client] Webhook registered: ${data.webhookCreate.webhook.id}`);
    return true;
  }

  console.error('[linear-client] Failed to register webhook');
  return false;
}
