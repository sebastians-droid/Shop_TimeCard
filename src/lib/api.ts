async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: { error?: string; message?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Request failed (${response.status}). ${text.replace(/\s+/g, ' ').slice(0, 240) || 'Empty response'}`,
    );
  }
  if (!response.ok) {
    const message =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export { apiFetch };
