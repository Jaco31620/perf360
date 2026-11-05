"use client";
/*
 * Revue « blind test » : une décision par chanson, rien d'autre — la vidéo
 * démarre là où le blind test la démarre (début gardé), trois choix (pas au
 * blind, oui, oui très difficile) puis la chanson suivante. Sert aux files
 * « 🕵️ Blind test à décider » et « 📊 Blind à reclasser ».
 */
import { useEffect, useRef, useState } from "react";
import { VideoPreview } from "../Controls";
import { formatDuration } from "@/lib/jukebox";
import { FR_NEXT, modeLabel, MODE_ICON } from "./shared";
import { SongName, SongTextForm, blindLevel } from "./SongParts";
import { backdropClose } from "@/lib/backdrop";
import { FrFlag } from "../FrFlag";

const CHOICES = [
  { level: 0, label: "Pas au blind test", hint: "jamais pioché", on: "bg-gray-700 text-white", off: "bg-gray-100 text-gray-700 hover:bg-gray-200" },
  { level: 1, label: "🕵️ Oui", hint: "pioché en soirée", on: "bg-violet-600 text-white", off: "bg-violet-50 text-violet-800 hover:bg-violet-100" },
  { level: 2, label: "🎓 Oui, très difficile", hint: "seulement si la soirée l'inclut (au plus 1 sur N)", on: "bg-amber-300 text-amber-950", off: "bg-amber-50 text-amber-900 hover:bg-amber-100" },
];

export function BlindReview({ review, setReview, songs, run, editYear, onClose, title }) {
  const { keys, i } = review;
  const song = i < keys.length ? (songs || []).find((s) => s.key === keys[i]) : null;
  const [editing, setEditing] = useState(null);
  useEffect(() => { setEditing(null); }, [i]);
  // correction du texte en cours : enregistrée d'office en quittant la chanson
  const draft = useRef(null);
  const commitDraft = () => {
    if (song && editing && draft.current) run({ action: "songText", key: song.key, artist: draft.current.artist, title: draft.current.title });
    draft.current = null;
  };
  const go = (d) => { commitDraft(); setReview((r) => ({ ...r, i: Math.max(0, Math.min(r.keys.length, r.i + d)) })); };
  const decide = (level) => { commitDraft(); run({ action: "blindDecide", key: song.key, level }); go(1); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = song ? blindLevel(song) : null;
  const tag = "text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap";
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-2 sm:p-3" {...backdropClose(onClose)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-5xl max-h-[97vh] flex flex-col bg-white rounded-3xl p-4 gap-3 shadow-2xl">
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-600 whitespace-nowrap">
            {title} · {Math.min(i + 1, keys.length)} / {keys.length}
          </p>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${(Math.min(i, keys.length) / keys.length) * 100}%` }} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Fermer" title="Fermer">×</button>
        </div>
        {i >= keys.length ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-3xl">🎉</p>
            <p className="font-bold">Terminé</p>
            <div className="flex justify-center gap-2">
              <button onClick={() => go(-1)} className="text-sm font-bold bg-gray-100 px-4 py-2 rounded-full">← Revenir au dernier</button>
              <button onClick={onClose} className="text-sm font-bold text-white bg-violet-600 px-4 py-2 rounded-full">Fermer</button>
            </div>
          </div>
        ) : !song ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-sm text-gray-500">Cette chanson n'est plus dans la liste.</p>
            <button onClick={() => go(1)} className="text-sm font-bold bg-gray-100 px-4 py-2 rounded-full">Suivante →</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)] items-start">
            <div className="mx-auto w-full" style={{ maxWidth: "calc((97vh - 200px) * 16 / 9)" }}>
              <VideoPreview videoId={song.videoId} start={Math.floor(song.start || 0)} />
              <p className="text-[11px] text-gray-400 mt-1">
                {MODE_ICON[song.mode]} Version {modeLabel(song.mode)} — celle que joue le blind test, depuis le début gardé{song.start > 0 ? ` (${formatDuration(Math.floor(song.start))})` : ""}.
                {!song.validated && <b className="text-orange-600"> Vidéo pas encore vérifiée.</b>}
              </p>
            </div>

            <div className="space-y-3 min-w-0">
              <div>
                {editing ? (
                  <SongTextForm song={song} focus={editing} draftRef={draft} onCancel={() => { draft.current = null; setEditing(null); }}
                    onSave={(artist, t) => { setEditing(null); run({ action: "songText", key: song.key, artist, title: t }); }} />
                ) : (
                  <SongName song={song} wrap className="text-lg font-bold leading-snug" titleHint="Corriger le texte (réponses attendues)"
                    onArtist={() => setEditing("artist")} onTitle={() => setEditing("title")} onEdit={() => setEditing("artist")} />
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <button onClick={() => editYear(song)} title="Année de sortie (cliquer pour corriger)"
                    className={`${tag} ${song.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>{song.year || "année ?"}</button>
                  <button onClick={() => run({ action: "songMeta", key: song.key, fr: FR_NEXT[String(song.fr)] })} title="Langue (cliquer : français → international → inconnue)"
                    className={`${tag} ${song.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                    {song.fr === true ? <><FrFlag /> Français</> : song.fr === false ? "🌍 International" : "❓ langue"}
                  </button>
                  {song.plays > 0 && <span className="text-xs font-bold text-gray-500">▶ joué {song.plays}×</span>}
                </div>
              </div>

              <div className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900">
                {!song.blindDecided
                  ? song.blind ? <>Actuellement <b>au blind test</b>, marqué avant la difficulté : <b>à confirmer</b>.</> : <>Pas encore décidé : <b>jamais pioché</b> pour l'instant.</>
                  : <>Décision actuelle : <b>{CHOICES[current].label}</b>.</>}
                {song.blindStat && (
                  <p className={`mt-1 ${song.rerank ? "font-bold text-orange-700" : ""}`}>
                    Trouvé par {song.blindStat.found} joueur{song.blindStat.found > 1 ? "s" : ""} sur {song.blindStat.n} (artiste ou titre)
                    {song.rerank === "hard" ? " : peu trouvé, très difficile ?" : song.rerank === "easy" ? " : souvent trouvé, difficulté normale ?" : ""}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {CHOICES.map((c) => {
                  const on = song.blindDecided && current === c.level;
                  return (
                    <button key={c.level} onClick={() => decide(c.level)}
                      className={`w-full text-left px-4 py-3 rounded-2xl font-bold ${on ? c.on : c.off}`}>
                      {c.label}{on && " ✓"}
                      <span className="block text-[11px] font-semibold opacity-70">{c.hint}{on ? " · garder ainsi" : ""}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <button onClick={() => go(-1)} disabled={i === 0} title="Précédente" className="text-sm font-bold bg-gray-100 px-3 py-2 rounded-2xl disabled:opacity-40">←</button>
                <button onClick={() => go(1)} className="flex-1 text-sm font-bold bg-gray-100 px-3 py-2 rounded-2xl">Décider plus tard →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
