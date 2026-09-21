function readErrorMessage(data: unknown, status: number): string {
  if (!data || typeof data !== 'object') return `Request failed (${status})`;
  const record = data as Record<string, unknown>;
  const nested = record.error;
  const fromError =
    typeof nested === 'string'
      ? nested
      : nested && typeof nested === 'object' && typeof (nested as { message?: unknown }).message === 'string'
        ? (nested as { message: string }).message
        : '';
  const fromMessage = typeof record.message === 'string' ? record.message : '';
  const health = record.health && typeof record.health === 'object' ? (record.health as Record<string, unknown>) : null;
  const healthError = typeof health?.error === 'string' ? health.error : '';
  const flags = health
    ? ` Credentials: org=${health.hasOrgUrl ? 'yes' : 'no'} (${String(health.orgHost || '')}), tenant=${health.hasTenantId ? 'yes' : 'no'}, client=${health.hasClientId ? 'yes' : 'no'}${health.clientIdTail ? ` …${health.clientIdTail}` : ''}, secret=${health.hasClientSecret ? 'yes' : 'no'}, token=${health.tokenOk ? 'yes' : 'no'}.`
    : '';
  const main = fromError || fromMessage || healthError || `Request failed (${status})`;
  if (healthError && healthError !== main) return `${main}${flags} Dataverse: ${healthError}`;
  return `${main}${flags}`.trim();
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== 'GET' && method !== 'HEAD' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  const text = await response.text();
  if (response.redirected && /\/\.auth\//i.test(response.url)) {
    throw new Error('Not signed in. Refresh the page and sign in with Microsoft 365.');
  }
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Request failed (${response.status}). ${text.replace(/\s+/g, ' ').slice(0, 240) || 'Empty response'}`,
    );
  }
  if (!response.ok) {
    throw new Error(readErrorMessage(data, response.status));
  }
  return data as T;
}

export { apiFetch };
