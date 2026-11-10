"use client";
/*
 * Soirée clip : « 🎬 Proposer le clip » d'un titre qui passe sa version
 * paroles (pas de clip validé). Le lien collé passe pour CE titre ; il sera
 * vérifié ensuite dans le super-admin avant de resservir (lib/jukeboxClip.js).
 * send(link) → message d'erreur, ou null si c'est fait.
 */
import { useState } from "react";
import { backdropClose } from "@/lib/backdrop";
import { parseVideoId } from "@/lib/jukebox";

export function NoClipTag({ className = "" }) {
  return <span className={`whitespace-nowrap ${className}`} title="Ce titre n'a pas encore de clip validé : c'est la version paroles qui passe">🎵 pas de clip validé</span>;
}

export function ProposeClip({ track, send, onClose }) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = !!parseVideoId(link);
  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError("");
    const err = await send(link.trim()).catch(() => "Proposition impossible (réseau).");
    setBusy(false);
    if (err) setError(err);
    else onClose(true);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" {...backdropClose(() => !busy && onClose(false))}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md bg-white text-gray-900 rounded-3xl p-5 shadow-2xl space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-bold leading-snug">🎬 Proposer le clip</p>
            <p className="text-sm text-gray-600 truncate">{track.title}{track.channel ? ` · ${track.channel}` : ""}</p>
          </div>
          <button type="button" onClick={() => onClose(false)} className="shrink-0 text-gray-400 hover:text-gray-700 text-xl leading-none px-1" aria-label="Fermer">✕</button>
        </div>
        <p className="text-xs text-gray-500">
          Collez le lien YouTube du clip de ce titre. Il passera à la place de la version paroles pour ce titre-ci, puis sera vérifié avant de
          resservir aux prochaines soirées.
        </p>
        <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" inputMode="url" autoComplete="off"
          className="w-full border-2 border-gray-200 rounded-2xl px-4 py-2.5 focus:border-fuchsia-500 outline-none" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => onClose(false)} disabled={busy} className="flex-1 bg-gray-100 text-gray-700 font-bold py-2.5 rounded-full">Annuler</button>
          <button disabled={!ok || busy} className="flex-[2] bg-fuchsia-600 hover:brightness-110 disabled:opacity-40 text-white font-bold py-2.5 rounded-full">
            {busy ? "Vérification…" : "Proposer ce clip"}
          </button>
        </div>
      </form>
    </div>
  );
}
