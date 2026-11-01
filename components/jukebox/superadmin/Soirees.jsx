"use client";
/*
 * Super-admin — liste des soirées : statut (en cours / prête / passée) avec
 * filtres, ligne compacte dépliable. Dépliée : suivi du lien (appareils qui
 * ont ouvert la régie ou la télécommande), lecteur du son, code régie,
 * fonctions, messages (organisateur, invités), affiche, renommer, supprimer.
 */
import { useState } from "react";
import Link from "next/link";
import { formatCode } from "../storage";
import { fmtRegieCode } from "../Access";
import { FEATURES } from "@/lib/jukebox";
import { inviteText, guestText } from "@/lib/jukeboxMessages";
import { fmtDate, SearchInput, RetentionSelect } from "./shared";
import { ShareBox } from "./SoireeForms";

const LIVE_MS = 3 * 60e3; // lecteur actif il y a moins de 3 min : soirée en cours

export const soireeStatus = (s) => (s.player && Date.now() - s.player.at < LIVE_MS ? "live" : s.played === 0 ? "ready" : "past");
const STATUSES = [
  { id: "all", label: "Toutes" },
  { id: "live", label: "🟢 En cours", hint: "La musique joue (lecteur actif il y a moins de 3 min)." },
  { id: "ready", label: "🟡 Prêtes", hint: "Aucun titre joué pour l'instant." },
  { id: "past", label: "⚪ Passées", hint: "Des titres ont été joués, plus de lecteur actif." },
];
const DOT = { live: "bg-green-500 animate-pulse", ready: "bg-amber-400", past: "bg-gray-300" };

function ago(ms) {
  const d = Date.now() - ms;
  if (d < 90e3) return "à l'instant";
  if (d < 3600e3) return `il y a ${Math.round(d / 60e3)} min`;
  if (d < 48 * 3600e3) return `il y a ${Math.round(d / 3600e3)} h`;
  return `il y a ${Math.round(d / 86400e3)} j`;
}
function fmtIn(ms) {
  const d = ms - Date.now();
  if (d <= 0) return "à la prochaine purge";
  const h = Math.round(d / 3600e3);
  return h < 48 ? `dans ${h} h` : `dans ${Math.round(h / 24)} j`;
}

export function Soirees({ sessions, globalRetention, origin, action, filter, setFilter, onShowCode }) {
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(null); // code de la soirée dépliée
  const [share, setShare] = useState(null); // { code, kind: "orga" | "guests", regieCode? }
  const q = filter.trim().toLowerCase();
  const matches = (s) => !q || s.name.toLowerCase().includes(q) || s.code.includes(q.replace(/\s/g, "")) || (s.organizer || "").toLowerCase().includes(q);
  const counts = { all: sessions.length };
  for (const s of sessions) counts[soireeStatus(s)] = (counts[soireeStatus(s)] || 0) + 1;
  const shown = sessions.filter((s) => matches(s) && (status === "all" || soireeStatus(s) === status));

  const shareOrga = async (s) => {
    const regieCode = s.regieCode || (await action({ action: "regie", code: s.code }))?.regieCode;
    if (regieCode) setShare({ code: s.code, kind: "orga", regieCode });
  };
  const rename = (s) => {
    const name = prompt("Nouveau nom de la soirée :", s.name);
    if (name && name.trim() && name.trim() !== s.name) action({ action: "rename", code: s.code, name: name.trim() });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap bg-white border border-purple-100 rounded-2xl p-0.5 text-sm">
          {STATUSES.map((st) => (
            <button key={st.id} onClick={() => setStatus(st.id)} title={st.hint}
              className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap ${status === st.id ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
              {st.label} <span className="font-normal opacity-70">{counts[st.id] || 0}</span>
            </button>
          ))}
        </div>
        {(sessions.length > 5 || filter) && (
          <SearchInput value={filter} onChange={setFilter} placeholder="Nom, code ou organisateur" className="flex-1 min-w-[200px]" />
        )}
      </div>

      {sessions.length === 0 && <p className="text-gray-400 text-center py-10">Aucune soirée.</p>}
      {sessions.length > 0 && shown.length === 0 && <p className="text-gray-400 text-center py-6">Aucune soirée ne correspond.</p>}

      {shown.map((s) => {
        const st = soireeStatus(s);
        const isOpen = open === s.code;
        const devices = s.devices || [];
        const used = devices.length > 0;
        return (
          <div key={s.code} className={`bg-white rounded-2xl border ${isOpen ? "border-fuchsia-300 shadow-md" : "border-purple-100"}`}>
            {/* ligne compacte */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => { setOpen(isOpen ? null : s.code); setShare(null); }} className="flex-1 min-w-0 flex items-center gap-3 text-left" aria-expanded={isOpen}>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT[st]}`} title={STATUSES.find((x) => x.id === st)?.hint} />
                <span className="min-w-0">
                  <span className="block font-bold text-gray-900 truncate">
                    {s.name} <span className="font-mono text-fuchsia-600 text-sm ml-1">{formatCode(s.code)}</span>
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    {s.organizer ? `👤 ${s.organizer} · ` : ""}
                    {st === "live" ? `🔊 en cours sur ${s.player.kind === "tv" ? "la télé" : "l'ordinateur"}` : `activité ${ago(s.lastActivity)}`}
                    {" · "}{s.played} titre{s.played > 1 ? "s" : ""}
                    {" · "}{used ? <span className="text-green-700">lien ouvert</span> : <span className="text-amber-700">⚠️ lien jamais ouvert</span>}
                  </span>
                </span>
              </button>
              <Link href={`/jukebox/${s.code}/regie`} target="_blank" className="hidden sm:inline-block text-sm font-bold bg-gray-900 text-white px-3 py-1.5 rounded-full shrink-0">Régie</Link>
              <button onClick={() => { setOpen(isOpen ? null : s.code); setShare(null); }} className="text-gray-400 text-sm shrink-0" aria-label={isOpen ? "Replier" : "Déplier"}>{isOpen ? "▲" : "▼"}</button>
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 px-4 py-4 space-y-4 text-sm">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className="font-bold text-gray-900">Suivi</p>
                    <p className="text-gray-600">Créée le {fmtDate(Date.parse(s.createdAt))}{s.organizer && <> par <b>{s.organizer}</b> <button onClick={() => onShowCode(s.organizer)} className="text-fuchsia-600 underline">voir son code</button></>}</p>
                    <p className="text-gray-600">{s.played} titre{s.played > 1 ? "s" : ""} joué{s.played > 1 ? "s" : ""}, {s.queued} en attente · dernière activité {ago(s.lastActivity)}</p>
                    {s.player && <p className="text-gray-600">🔊 Son {st === "live" ? "en ce moment" : `joué pour la dernière fois ${ago(s.player.at)}`} sur {s.player.kind === "tv" ? "la télé" : "l'ordinateur"}</p>}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <RetentionSelect value={s.retentionDays} global={globalRetention} className="text-xs"
                        onChange={(days) => action({ action: "retention", code: s.code, days })} />
                      <span className="text-xs text-gray-400">suppression {fmtIn(s.expiresAt)}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-bold text-gray-900">Appareils de l'organisateur</p>
                    {used ? (
                      <ul className="space-y-1">
                        {devices.map((d, i) => (
                          <li key={i} className="text-gray-600">
                            {/télé/i.test(d.label) ? "📺" : "📱"} {d.label} <span className="text-xs text-gray-400">· ajouté le {fmtDate(Date.parse(d.createdAt))}, vu {ago(Date.parse(d.lastSeen))}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-amber-700">⚠️ Personne n'a encore ouvert la régie ou la télécommande avec le lien. Renvoyez l'invitation ?</p>
                    )}
                    <p className="text-gray-600 pt-1">
                      🔑 Code régie <b className="font-mono tracking-wider">{s.regieCode ? fmtRegieCode(s.regieCode) : "—"}</b>
                      <button onClick={async () => {
                        if (!confirm(`Nouveau code régie pour « ${s.name} » ? L'ancien ne fonctionnera plus.`)) return;
                        await action({ action: "regie", code: s.code, reset: true, logoutAll: confirm("Déconnecter aussi tous les appareils déjà autorisés ?\n\nOK : déconnecter · Annuler : les garder connectés") });
                      }} className="ml-2 text-fuchsia-600 underline">{s.regieCode ? "changer" : "créer"}</button>
                    </p>
                  </div>
                </div>

                <div>
                  <p className="font-bold text-gray-900 mb-1.5">Fonctions <span className="font-normal text-xs text-gray-400">(cliquer pour activer / désactiver)</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {FEATURES.map((f) => {
                      const on = s.features?.[f.id];
                      return (
                        <button key={f.id} title={`${f.hint}\nCliquer pour ${on ? "désactiver" : "activer"}.`}
                          onClick={() => action({ action: "features", code: s.code, features: { [f.id]: !on } })}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${on ? "bg-fuchsia-100 text-fuchsia-700" : "bg-gray-100 text-gray-400 line-through"}`}>
                          {f.icon} {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => shareOrga(s)} className={`font-bold px-3 py-1.5 rounded-full ${share?.kind === "orga" ? "bg-fuchsia-700 text-white" : "bg-fuchsia-600 text-white"}`}>📨 Invitation organisateur</button>
                  <button onClick={() => setShare(share?.kind === "guests" ? null : { code: s.code, kind: "guests" })} className="font-bold bg-fuchsia-100 text-fuchsia-800 px-3 py-1.5 rounded-full">💬 Message invités</button>
                  <Link href={`/jukebox/${s.code}/affiche`} target="_blank" className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">🖨️ Affiche</Link>
                  <Link href={`/jukebox/${s.code}/regie`} target="_blank" className="font-bold bg-gray-900 text-white px-3 py-1.5 rounded-full">💻 Régie</Link>
                  <Link href={`/jukebox/${s.code}/ecran`} target="_blank" className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">📺 Écran</Link>
                  <button onClick={() => rename(s)} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">✏️ Renommer</button>
                  <button onClick={() => action({ action: "delete", code: s.code }, `Supprimer définitivement « ${s.name} » ?`)}
                    className="font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full ml-auto">Supprimer</button>
                </div>

                {share?.code === s.code && share.kind === "orga" && (
                  <ShareBox title={`Invitation pour l'organisateur de « ${s.name} »`} subject={`Jukebox · soirée « ${s.name} »`}
                    message={inviteText({ origin, code: s.code, name: s.name, regieCode: share.regieCode })} onClose={() => setShare(null)} />
                )}
                {share?.code === s.code && share.kind === "guests" && (
                  <ShareBox title="Message pour les invités" subject={`Jukebox « ${s.name} »`}
                    message={guestText({ origin, code: s.code, name: s.name })} onClose={() => setShare(null)} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
