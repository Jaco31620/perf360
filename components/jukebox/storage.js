"use client";
/*
 * Stockage local du jukebox : identifiant participant, prénom, jetons régie
 * et liste « Mes soirées ». Tout est protégé par try/catch (navigation
 * privée, stockage bloqué…).
 */

function get(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function set(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* ignoré */ }
}

export function participantId() {
  let pid = get("jukebox_pid");
  if (!pid) {
    pid = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    set("jukebox_pid", pid);
  }
  return pid;
}

export const getName = () => get("jukebox_name") || "";
export const setName = (name) => set("jukebox_name", name);

export const getAdminToken = (code) => get(`jukebox_admin_${code}`);
export const setAdminToken = (code, token) => set(`jukebox_admin_${code}`, token);

export function myParties() {
  try { return JSON.parse(get("jukebox_mine") || "[]"); } catch (e) { return []; }
}
export function rememberParty(code, name) {
  const list = myParties().filter((c) => c.code !== code);
  list.unshift({ code, name, createdAt: new Date().toISOString() });
  set("jukebox_mine", JSON.stringify(list.slice(0, 30)));
}
export function forgetParty(code) {
  set("jukebox_mine", JSON.stringify(myParties().filter((c) => c.code !== code)));
  try { localStorage.removeItem(`jukebox_admin_${code}`); } catch (e) { /* ignoré */ }
}

export const formatCode = (code) => `${String(code).slice(0, 3)} ${String(code).slice(3)}`;
