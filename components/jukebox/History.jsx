"use client";
/*
 * Jukebox — historique de la soirée (fonction activée par le super-admin) :
 * titres joués, du plus récent au plus ancien, avec l'invité et la dédicace ;
 * copie de la liste, export CSV (Excel), titre remis en fin de file, effacement.
 */
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { authHeaders } from "./storage";

const hour = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

export default function History({ code, name, onClose, onChanged }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const post = useCallback(async (body) => {
    const res = await fetch(`/api/jukebox/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(code) },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  }, [code]);

  const load = useCallback(async () => {
    try { setList((await post({ action: "history" })).history); setError(""); } catch (e) { setError(e.message); }
  }, [post]);
  useEffect(() => { load(); }, [load]);

  const say = (text) => { setFlash(text); setTimeout(() => setFlash(""), 2500); };

  const replay = async (t) => {
    say(`« ${t.title} » remis dans la file.`); // tout de suite, confirmé par le serveur ensuite
    try { await post({ action: "replay", id: t.id }); onChanged?.(); } catch (e) { setFlash(""); alert(e.message); }
  };

  const ordered = () => [...(list || [])].reverse(); // export : ordre de passage
  const copy = async () => {
    const text = ordered().map((t) => `${hour(t.playedAt)}  ${t.channel} – ${t.title}${t.author ? ` (${t.author})` : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); say("Liste copiée."); } catch (e) { alert("Copie impossible."); }
  };
  const csv = () => {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Heure", "Artiste", "Titre", "Proposé par", "Dédicace", "Passé", "Lien"],
      ...ordered().map((t) => [hour(t.playedAt), t.channel, t.title, t.author, t.dedication, t.skipped ? "oui" : "",
        `https://youtu.be/${t.videoId}`])];
    // point-virgule + BOM : ouverture directe dans Excel en français
    const blob = new Blob(["﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jukebox-${(name || code).replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const clear = async () => {
    if (!confirm("Effacer tout l'historique de la soirée ?")) return;
    setList([]);
    try { await post({ action: "clearHistory" }); } catch (e) { alert(e.message); load(); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-gray-900 text-white rounded-3xl shadow-2xl">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold flex-1">🕘 Historique {list && <span className="text-white/40 font-normal">({list.length})</span>}</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-white/50 hover:text-white"><X size={20} /></button>
        </div>
        {list?.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pb-3 text-sm">
            <button onClick={copy} className="font-bold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full">Copier la liste</button>
            <button onClick={csv} className="font-bold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full">Télécharger (Excel)</button>
            <button onClick={clear} className="font-bold text-red-300 hover:bg-red-500/20 px-3 py-1.5 rounded-full ml-auto">Effacer</button>
          </div>
        )}
        {flash && <p className="px-5 pb-2 text-sm text-green-400">{flash}</p>}
        <div className="overflow-y-auto px-5 pb-5">
          {error ? <p className="text-sm text-red-400">{error}</p>
            : list === null ? <p className="text-sm text-white/50">Chargement…</p>
            : list.length === 0 ? <p className="text-sm text-white/50">Aucun titre joué pour l'instant.</p>
            : (
              <ul className="space-y-2">
                {list.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 bg-white/5 rounded-xl p-2">
                    <span className="text-xs text-white/40 tabular-nums w-10 shrink-0">{hour(t.playedAt)}</span>
                    {t.thumb && <img src={t.thumb} alt="" className="w-14 h-8 object-cover rounded shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{t.title}</p>
                      <p className="text-xs text-white/50 truncate">
                        {t.channel}{t.author ? ` · ${t.author}` : ""}{t.skipped ? " · passé" : ""}
                      </p>
                      {t.dedication && <p className="text-xs text-fuchsia-300 italic truncate">💌 « {t.dedication} »</p>}
                    </div>
                    <button onClick={() => replay(t)} title="Remettre en fin de file"
                      className="inline-flex items-center gap-1 text-xs font-bold bg-white/10 hover:bg-white/20 px-2.5 py-1.5 rounded-full shrink-0">
                      <RotateCcw size={13} /> Rejouer
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}
