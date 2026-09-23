async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "Request failed");
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request("/api/auth/me"),
  login: (username, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  settings: () => request("/api/settings"),
  saveSettings: (body) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  targets: () => request("/api/targets"),
  createTarget: (body) =>
    request("/api/targets", { method: "POST", body: JSON.stringify(body) }),
  getTarget: (id) => request(`/api/targets/${id}`),
  updateTarget: (id, body) =>
    request(`/api/targets/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTarget: (id) => request(`/api/targets/${id}`, { method: "DELETE" }),
  syncAll: () => request("/api/sync", { method: "POST" }),
  syncTarget: (id) => request(`/api/targets/${id}/sync`, { method: "POST" }),
  regenerate: (id) =>
    request(`/api/targets/${id}/regenerate`, { method: "POST" }),
  sendDraft: (id, body) =>
    request(`/api/drafts/${id}/send`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  sendMessage: (targetId, body) =>
    request(`/api/targets/${targetId}/send`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  gvStatus: () => request("/api/gv/status"),
  gvReconnect: () => request("/api/gv/reconnect", { method: "POST" }),
  restartGvChrome: () =>
    request("/api/gv/chrome/restart", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    }),
};
