const ACTIVE_STATUSES = new Set(['idle', 'created', 'routed', 'running', 'executing', 'paused']);

export interface SessionListItem {
  id: string;
  goal: string;
  status: string;
  route: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt?: string;
  budget?: {
    maxTokens: number;
    tokensUsed?: number;
  };
}

function latestActivityTimestamp(session: SessionListItem): number {
  const raw = session.updatedAt ?? session.createdAt;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Single source of truth for the session "active set". Any view that counts or
// sorts active sessions must use this — don't re-inline the status literal.
export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

function isActive(session: SessionListItem): boolean {
  return isActiveStatus(session.status);
}

export function filterAndSortSessions(
  sessions: SessionListItem[] | undefined,
  searchQuery: string,
  statusFilter: string,
): SessionListItem[] {
  if (!sessions) return [];

  const query = searchQuery.trim().toLowerCase();

  return [...sessions]
    .filter((session) => {
      const matchesSearch =
        !query ||
        session.goal.toLowerCase().includes(query) ||
        session.id.toLowerCase().includes(query) ||
        session.route.id.toLowerCase().includes(query) ||
        session.route.name.toLowerCase().includes(query);
      const matchesStatus = !statusFilter || session.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((left, right) => {
      const activeDelta = Number(isActive(right)) - Number(isActive(left));
      if (activeDelta !== 0) return activeDelta;
      return latestActivityTimestamp(right) - latestActivityTimestamp(left);
    });
}
