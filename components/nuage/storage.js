"use client";
/*
 * Stockage local du nuage de mots : identifiant participant, jetons
 * présentateur et liste « Mes nuages ». Tout est protégé par try/catch
 * (navigation privée, stockage bloqué…).
 */

function get(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function set(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* ignoré */ }
}

export function participantId() {
  let pid = get("nuage_pid");
  if (!pid) {
    pid = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    set("nuage_pid", pid);
  }
  return pid;
}

export const getAdminToken = (code) => get(`nuage_admin_${code}`);
export const setAdminToken = (code, token) => set(`nuage_admin_${code}`, token);

export function myClouds() {
  try { return JSON.parse(get("nuage_mine") || "[]"); } catch (e) { return []; }
}
export function rememberCloud(code, question) {
  const list = myClouds().filter((c) => c.code !== code);
  list.unshift({ code, question, createdAt: new Date().toISOString() });
  set("nuage_mine", JSON.stringify(list.slice(0, 30)));
}
export function forgetCloud(code) {
  set("nuage_mine", JSON.stringify(myClouds().filter((c) => c.code !== code)));
  try { localStorage.removeItem(`nuage_admin_${code}`); } catch (e) { /* ignoré */ }
}

export const formatCode = (code) => `${String(code).slice(0, 3)} ${String(code).slice(3)}`;
