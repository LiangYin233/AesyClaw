import type { LocationQuery, LocationQueryRaw, RouteLocationNormalizedLoaded } from 'vue-router';

export function normalizeToken(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeToken(value[0]);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim();
  return token || null;
}

export function getRouteToken(route: Pick<RouteLocationNormalizedLoaded, 'query'> | { query: LocationQuery }): string | null {
  return normalizeToken(route.query.token);
}

export function buildTokenQuery(query: LocationQuery | LocationQueryRaw | undefined, token: string | null): LocationQueryRaw {
  const nextQuery: LocationQueryRaw = { ...(query || {}) };
  if (token) {
    nextQuery.token = token;
  }
  return nextQuery;
}
