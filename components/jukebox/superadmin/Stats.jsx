"use client";
/*
 * Super-admin — statistiques (soirées par mois, titres joués, demandes,
 * codes) et exports CSV des soirées et des demandes. Calculé à partir des
 * données déjà chargées (soirées non supprimées, 30 dernières demandes traitées).
 */
import { formatCode } from "../storage";

const monthKey = (iso) => String(iso || "").slice(0, 7);
const monthLabel = (k) => new Date(`${k}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

function csv(rows) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\n"); // BOM + « ; » : ouverture directe dans Excel
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export function Stats({ sessions = [], requests, activations }) {
  const months = {};
  for (const s of sessions) {
    const m = (months[monthKey(s.createdAt)] ||= { parties: 0, played: 0 });
    m.parties++;
    m.played += s.played;
  }
  const keys = Object.keys(months).sort().reverse();
  const played = sessions.reduce((n, s) => n + s.played, 0);
  const used = sessions.filter((s) => s.played > 0).length;
  const req = requests || [];
  const reqBy = (st) => req.filter((r) => r.status === st).length;
  const approved = req.filter((r) => r.status === "approved");
  const converted = approved.filter((r) => (activations || []).find((a) => a.id === r.activationId)?.used > 0).length;
  const acts = activations || [];

  const exportSessions = () => download(`jukebox-soirees-${day(Date.now())}.csv`, csv([
    ["Code", "Nom", "Organisateur", "Créée le", "Titres joués", "En attente", "Dernière activité", "Fermeture", "État"],
    ...sessions.map((s) => [formatCode(s.code), s.name, s.organizer || "", day(Date.parse(s.createdAt)), s.played, s.queued, day(s.lastActivity), day(s.endsAt),
      s.closedReason ? "fermée" : "ouverte"]),
  ]));
  const exportRequests = () => download(`jukebox-demandes-${day(Date.now())}.csv`, csv([
    ["Reçue le", "Nom", "E-mail", "Date de la soirée", "Invités", "Message", "État", "Traitée le", "Code"],
    ...req.map((r) => [day(Date.parse(r.createdAt)), r.name, r.email, r.date || "", r.guests || "", r.message || "",
      { pending: "en attente", approved: "validée", rejected: "refusée" }[r.status] || r.status, day(Date.parse(r.handledAt)), acts.find((a) => a.id === r.activationId)?.code || ""]),
  ]));

  const Tile = ({ label, value, sub }) => (
    <div className="bg-white rounded-2xl border border-purple-100 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-black text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="🎉 Soirées" value={sessions.length} sub={`${used} avec de la musique`} />
        <Tile label="🎵 Titres joués" value={played} sub={used ? `${Math.round(played / used)} par soirée en moyenne` : null} />
        <Tile label="📥 Demandes" value={req.length} sub={requests == null ? "table v23 absente" : `${reqBy("pending")} en attente · ${approved.length} validées · ${reqBy("rejected")} refusées`} />
        <Tile label="🎟️ Codes utilisés" value={`${acts.filter((a) => a.used > 0).length} / ${acts.length}`} sub={approved.length ? `${converted} demande${converted > 1 ? "s" : ""} validée${converted > 1 ? "s" : ""} → soirée créée` : null} />
      </div>
      <div className="bg-white rounded-2xl border border-purple-100 p-4">
        <h2 className="font-bold text-gray-900 mb-2">Par mois</h2>
        {keys.length === 0 ? <p className="text-sm text-gray-400">Aucune soirée.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400"><th className="py-1 font-semibold">Mois</th><th className="font-semibold text-right">Soirées</th><th className="font-semibold text-right">Titres joués</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t border-gray-100"><td className="py-1.5 capitalize">{monthLabel(k)}</td><td className="text-right tabular-nums">{months[k].parties}</td><td className="text-right tabular-nums">{months[k].played}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-400 mt-2">Soirées encore présentes (les soirées supprimées ne comptent plus) ; demandes : en attente + 30 dernières traitées.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={exportSessions} className="font-bold bg-gray-900 text-white px-4 py-2 rounded-full text-sm">⬇️ Exporter les soirées (CSV)</button>
        {requests != null && <button onClick={exportRequests} className="font-bold bg-gray-100 px-4 py-2 rounded-full text-sm">⬇️ Exporter les demandes (CSV)</button>}
      </div>
    </div>
  );
}
