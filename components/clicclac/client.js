"use client";
/*
 * Clic-Clac — helpers navigateur : jetons (localStorage), identifiant invité,
 * appels API, fusion des liens signés (on garde les liens déjà chargés pour ne
 * pas re-télécharger les images à chaque rafraîchissement).
 */

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignoré */ } },
};
export const storage = ls;

export const superToken = () => ls.get("cc_super");
export const adminToken = (code) => ls.get(`cc_admin_${code}`);
export const boothToken = (code) => ls.get(`cc_booth_${code}`);

export function guestId() {
  let id = ls.get("cc_guest");
  if (!id) {
    id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).toLowerCase();
    ls.set("cc_guest", id);
  }
  return id;
}

/* Jeton le plus élevé disponible pour cet album (organisateur > super > borne). */
export const anyToken = (code) => adminToken(code) || superToken() || boothToken(code);

export async function api(path, { method = "GET", token, body, form } = {}) {
  const headers = {};
  if (token) headers["x-cc-auth"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/clicclac${path}`, {
    method, headers, cache: "no-store",
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* Fusionne une nouvelle liste de photos en conservant les liens déjà connus
 * (valables 1 h) tant qu'ils ont moins de 45 min. */
export function mergePhotos(prev, next) {
  const now = Date.now();
  const old = new Map(prev.map((p) => [p.id, p]));
  return next.map((p) => {
    const o = old.get(p.id);
    return o && now - o._at < 45 * 60 * 1000 ? { ...p, thumb: o.thumb, full: o.full, hd: o.hd ?? p.hd, _at: o._at } : { ...p, _at: now };
  });
}

export const formatBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} Go` : b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.round(b / 1e3)} Ko`);
export const formatDate = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
