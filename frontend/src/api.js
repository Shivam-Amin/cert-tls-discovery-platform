// Every call to the backend goes through here. Errors become Error objects
// with the backend's message, so pages can just show err.message.

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the backend. Is it running? (cd backend && sudo npm start)');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  summary: () => request('GET', '/summary'),
  runs: () => request('GET', '/runs'),
  run: (id) => request('GET', `/runs/${id}`),
  certificates: (id) => request('GET', `/runs/${id}/certificates`),
  tls: (id) => request('GET', `/runs/${id}/tls`),
  relationships: (id) => request('GET', `/runs/${id}/relationships`),
  startRun: (type, params) => request('POST', '/runs', { type, params }),
  schedules: () => request('GET', '/schedules'),
  saveSchedule: (type, body) => request('PUT', `/schedules/${type}`, body),
};
