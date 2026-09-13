// Admin gate client (PHP backend at /api/*.php — same origin)

async function call(path: string, body?: unknown): Promise<any> {
  try {
    const r = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'NEXUS' } : { 'X-Requested-With': 'NEXUS' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, error: r.status === 404 ? 'backend-unavailable' : `HTTP ${r.status}` };
    return j;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const adminApi = {
  session: () => call('session.php'),
  login: (username: string, password: string) => call('login.php', { action: 'login', username, password }),
  setup: (username: string, password: string) => call('login.php', { action: 'setup', username, password }),
  logout: () => call('logout.php', {}),
  audit: () => call('audit.php'),
  users: (action: string, extra?: Record<string, unknown>) => call('users.php', { action, ...(extra ?? {}) }),
};
