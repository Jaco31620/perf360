"use client";
/*
 * Régie et télécommande : un réglage change à l'écran dès le clic, sans
 * attendre l'aller-retour serveur (optimistic), et les actions partent une
 * par une, dans l'ordre des clics. Une réponse de rafraîchissement partie
 * avant la fin d'une action est ignorée (elle montrerait l'ancien état).
 */
import { useCallback, useRef } from "react";
import { authHeaders } from "./storage";

/* État affiché après une action, avant la réponse du serveur. */
function applyLocally(data, action, extra) {
  const session = data?.session;
  if (!session) return data;
  let patch = null;
  if (action === "options") patch = extra;
  else if (action === "max") patch = { maxPerParticipant: extra.max };
  else if (action === "searchMode") patch = { searchMode: extra.mode };
  else if (action === "open" || action === "close") patch = { status: action === "open" ? "open" : "closed" };
  else if (action === "theme" && session.theme) patch = { theme: { ...session.theme, ...extra } };
  else if (action === "blind" && session.blindSettings) patch = { blindSettings: { ...session.blindSettings, ...extra } };
  return patch ? { ...data, session: { ...session, ...patch } } : data;
}

/* { act, fresh, refreshRef } : act(action, extra, silent) → true si réussie ;
 * fresh(startedAt) → false si une action a eu lieu depuis le début du
 * rafraîchissement (réponse à ignorer) ; refreshRef.current = rafraîchir. */
export function useAdminActions(code, setData) {
  const queue = useRef(Promise.resolve());
  const lastAct = useRef(0);
  const refreshRef = useRef(async () => {});
  const refresh = () => refreshRef.current();
  const fresh = useCallback((startedAt) => startedAt > lastAct.current, []);
  const act = useCallback((action, extra = {}, silent = false) => {
    lastAct.current = Date.now();
    setData((d) => applyLocally(d, action, extra));
    const run = queue.current.then(async () => {
      try {
        const res = await fetch(`/api/jukebox/${code}/admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(code) },
          body: JSON.stringify({ action, ...extra }),
        });
        const d = await res.json().catch(() => ({}));
        lastAct.current = Date.now();
        if (!res.ok) { if (!silent) alert(d.error || "Action impossible."); await refresh(); return false; }
        return true;
      } catch (e) {
        if (!silent) alert("Action impossible (réseau).");
        return false;
      }
    });
    queue.current = run.then(() => {}, () => {});
    return run.then(async (ok) => { if (ok) await refresh(); return ok; });
  }, [code, setData]); // eslint-disable-line react-hooks/exhaustive-deps
  return { act, fresh, refreshRef };
}
