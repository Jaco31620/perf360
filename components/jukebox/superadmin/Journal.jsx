"use client";
/*
 * Super-admin — journal d'une soirée (table jukebox_events, SQL v27) : qui a
 * fait quoi et quand, du plus récent au plus ancien. Filtre « incidents »
 * (erreurs du lecteur, relances, onglet en double) pour diagnostiquer une
 * soirée qui s'est mal passée.
 */
import { useEffect, useState } from "react";
import { getSuperToken } from "../storage";

const KINDS = {
  created: ["🎉", "Soirée créée"],
  add: ["➕", "Titre ajouté"],
  unadd: ["↩️", "Titre retiré par l'invité"],
  play: ["▶️", "Titre lancé"],
  skip: ["⏭", "Titre sauté"],
  playnow: ["⚡", "Lancé tout de suite"],
  remove: ["🗑️", "Titre retiré de la file"],
  replay: ["🔁", "Titre rejoué"],
  reset: ["🧹", "File vidée"],
  video_changed: ["🎬", "Vidéo changée"],
  reported: ["🚩", "Problème signalé"],
  dedication_cleared: ["💬", "Dédicace effacée"],
  pause: ["⏸", "Pause"],
  resume: ["▶️", "Lecture"],
  sound: ["🔊", "Son pris sur"],
  handoff: ["📺", "Son renvoyé vers la télé"],
  adds_open: ["🟢", "Ajouts ouverts"],
  adds_blocked: ["🚫", "Ajouts bloqués"],
  setting: ["⚙️", "Réglage"],
  rename: ["✏️", "Renommée"],
  theme: ["🎨", "Thème modifié"],
  blind_start: ["🕵️", "Blind test lancé"],
  blind_stop: ["🏁", "Blind test arrêté"],
  blind_settings: ["🕵️", "Réglages du blind test"],
  blind_reveal: ["👀", "Titre dévoilé"],
  blind_accept: ["✅", "Réponse acceptée"],
  blind_new_game: ["🔄", "Nouvelle partie"],
  blind_reset: ["0️⃣", "Scores remis à zéro"],
  history_cleared: ["🧹", "Historique effacé"],
  device_join: ["📱", "Appareil connecté à la régie"],
  device_revoked: ["🚪", "Appareil retiré"],
  regie_code: ["🔑", "Nouveau code régie"],
  tv_pair: ["📺", "Télé jumelée"],
  player_error: ["❌", "Erreur du lecteur"],
  stuck: ["⏳", "Chargement bloqué, relancé"],
  retry_next: ["🔁", "Titre suivant relancé (réseau)"],
  duplicate_tab: ["👯", "Lecteur ouvert dans un 2e onglet"],
  autoplay_blocked: ["🔇", "Lecture automatique bloquée"],
  super_prolong: ["➕", "Prolongée"],
  super_close: ["🔒", "Fermeture"],
  super_validity: ["⏱️", "Délai de fermeture"],
  super_rename: ["✏️", "Renommée"],
  super_features: ["🧩", "Fonctions modifiées"],
  super_regie: ["🔑", "Nouveau code régie"],
};
const INCIDENTS = new Set(["player_error", "stuck", "retry_next", "duplicate_tab", "autoplay_blocked"]);
// codes d'erreur du lecteur YouTube
const YT_ERRORS = { 2: "paramètre invalide", 5: "erreur HTML5", 100: "vidéo introuvable ou privée", 101: "lecture intégrée interdite", 150: "lecture intégrée interdite" };
const LABELS = { title: "", next: "suivant", via: "via", device: "", claim: "à la demande", max: "titres en attente max", searchMode: "mode", options: "", name: "", mode: "mode", part: "", scores: "", days: "jours", closed: "", logoutAll: "appareils déconnectés", sound: "", activation: "code", validDays: "fermeture après (j)", mailedTo: "", lecteur: "lecteur", track: "", code: "erreur", video: "vidéo", reasons: "" };

function details(e) {
  const d = e.data || {};
  return Object.entries(d).filter(([k]) => k !== "track").map(([k, v]) => {
    if (k === "code" && YT_ERRORS[v]) v = `${v} (${YT_ERRORS[v]})`;
    const l = LABELS[k] ?? k;
    return l ? `${l} : ${v}` : String(v);
  }).join(" · ");
}

const fmt = (iso) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function Journal({ code }) {
  const [events, setEvents] = useState(undefined); // undefined : chargement ; null : table absente
  const [only, setOnly] = useState("all");
  const [err, setErr] = useState("");
  const load = async () => {
    try {
      const res = await fetch(`/api/jukebox/super?events=${code}`, { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      setEvents(d.events);
      setErr("");
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (events === undefined) return <p className="text-sm text-gray-400">Chargement du journal…</p>;
  if (events === null) return <p className="text-sm text-amber-700">Journal indisponible : SQL v27 à appliquer.</p>;
  const nIncidents = events.filter((e) => INCIDENTS.has(e.kind)).length;
  const shown = events.filter((e) => only === "all" || (only === "incidents" ? INCIDENTS.has(e.kind) : !INCIDENTS.has(e.kind) && e.kind !== "add" && e.kind !== "play"));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[["all", `Tout (${events.length})`], ["actions", "Actions"], ["incidents", `Incidents${nIncidents ? ` (${nIncidents})` : ""}`]].map(([id, label]) => (
          <button key={id} onClick={() => setOnly(id)} className={`px-3 py-1 rounded-full font-bold ${only === id ? "bg-gray-900 text-white" : id === "incidents" && nIncidents ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>{label}</button>
        ))}
        <button onClick={load} className="ml-auto underline text-gray-500">actualiser</button>
      </div>
      {!shown.length ? (
        <p className="text-sm text-gray-400">{events.length ? "Rien dans ce filtre." : "Rien de noté pour l'instant (le journal démarre avec le SQL v27)."}</p>
      ) : (
        <ul className="max-h-96 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-xl text-sm">
          {shown.map((e) => {
            const [icon, label] = KINDS[e.kind] || ["•", e.kind];
            return (
              <li key={e.id} className={`flex gap-2 px-3 py-1.5 ${INCIDENTS.has(e.kind) ? "bg-red-50/60" : ""}`}>
                <span className="text-gray-400 tabular-nums text-xs pt-0.5 shrink-0">{fmt(e.at)}</span>
                <span className="shrink-0">{icon}</span>
                <span className="min-w-0">
                  <b>{label}</b>{details(e) && <span className="text-gray-600"> · {details(e)}</span>}
                  {e.actor && <span className="text-gray-400"> — {e.actor}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
