"use client";
/*
 * Jukebox — aperçu d'une vidéo avec rognage (revue du super-admin) : lecteur
 * YouTube (API IFrame, pour lire la position), boutons « Début ici » /
 * « Fin ici » (touches D et F), réglage fin ±1 s, écoute du début et de la
 * fin de la partie gardée, suggestion SponsorBlock (passages sans musique,
 * intro, outro) à appliquer d'un clic. Chaque changement est enregistré
 * (onSave) : il vaut pour cette vidéo dans toutes les soirées.
 */
import { useEffect, useRef, useState } from "react";
import { loadYouTubeApi, createPlayer } from "./youtube";
import { formatDuration } from "@/lib/jukebox";

const fmt = (x) => {
  if (x == null) return "fin";
  const m = Math.floor(x / 60);
  const s = x - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1).replace(/\.0$/, "")}`;
};
const r1 = (x) => Math.round(x * 10) / 10;

const Key = ({ k }) => <kbd className="ml-1 text-[10px] font-mono bg-black/10 rounded px-1">{k}</kbd>;

export default function TrimPlayer({ song, previewStart = 0, onSave, suggest, busy = false }) {
  const box = useRef(null);
  const player = useRef(null);
  const stopAt = useRef(null); // écoute de la fin : pause à la fin gardée
  const [ready, setReady] = useState(false);
  const [start, setStart] = useState(song.start || 0);
  const [end, setEnd] = useState(song.end ?? null);
  const [hint, setHint] = useState(undefined); // suggestion SponsorBlock ; undefined : en cours
  const [now, setNow] = useState(0);
  const duration = song.duration || 0;
  const trimmed = start > 0 || end != null;

  // un lecteur par vidéo
  useEffect(() => {
    let gone = false;
    setReady(false);
    setStart(song.start || 0);
    setEnd(song.end ?? null);
    loadYouTubeApi().then(() => {
      if (gone || !box.current) return;
      box.current.innerHTML = "";
      player.current = createPlayer(box.current, {
        videoId: song.videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, start: Math.floor(song.start || previewStart) },
        events: { onReady: () => !gone && setReady(true) },
      });
    });
    return () => { gone = true; try { player.current?.destroy(); } catch (e) { /* déjà détruit */ } player.current = null; };
  }, [song.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggestion SponsorBlock pour cette vidéo
  useEffect(() => {
    let gone = false;
    setHint(undefined);
    suggest?.(song.videoId, duration).then((h) => !gone && setHint(h || null)).catch(() => !gone && setHint(null));
    return () => { gone = true; };
  }, [song.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // position affichée + arrêt à la fin gardée pendant l'écoute de la fin
  useEffect(() => {
    const id = setInterval(() => {
      const p = player.current;
      if (!p?.getCurrentTime) return;
      const t = p.getCurrentTime();
      setNow(t);
      if (stopAt.current != null && t >= stopAt.current) { p.pauseVideo(); stopAt.current = null; }
    }, 200);
    return () => clearInterval(id);
  }, []);

  const save = (s, e, source = "manual") => {
    s = Math.max(0, r1(s));
    e = e == null ? null : r1(Math.min(e, duration || e));
    if (e != null && duration && e >= duration - 0.5) e = null;
    if (e != null && e <= s + 20) return alert("La partie gardée doit durer au moins 20 secondes.");
    setStart(s);
    setEnd(e);
    onSave({ videoId: song.videoId, start: s, end: e, source });
  };
  const pos = () => player.current?.getCurrentTime?.() || 0;
  const play = (t, until = null) => {
    const p = player.current;
    if (!p) return;
    p.seekTo(Math.max(0, t), true);
    p.playVideo();
    stopAt.current = until;
  };
  const setStartHere = () => save(pos(), end);
  const setEndHere = () => save(start, pos());

  const keys = useRef({});
  keys.current = busy ? {} : { d: setStartHere, f: setEndHere }; // fenêtre ouverte par-dessus : touches et lecture en pause
  useEffect(() => { if (busy) try { player.current?.pauseVideo?.(); } catch (e) { /* lecteur pas prêt */ } }, [busy]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const fn = keys.current[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const keptEnd = end ?? duration;
  const hintUseful = hint && (hint.start > 0 || hint.end != null) && (Math.abs(hint.start - start) > 0.5 || (hint.end ?? null) !== (end ?? null));
  const btn = "text-xs font-bold bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-40";
  const nudge = "text-[11px] font-bold text-gray-500 hover:text-gray-900 bg-gray-50 px-1.5 py-0.5 rounded";

  return (
    <div className="space-y-2">
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
        <div ref={box} className="absolute inset-0" />
      </div>
      {/* frise : partie gardée en couleur, position de lecture */}
      {duration > 0 && (
        <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden" title="Partie jouée en soirée">
          <div className="absolute inset-y-0 bg-fuchsia-400" style={{ left: `${(start / duration) * 100}%`, width: `${((keptEnd - start) / duration) * 100}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-gray-900" style={{ left: `${Math.min(100, (now / duration) * 100)}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={setStartHere} disabled={!ready} className={btn} title="La soirée démarrera la vidéo ici">⏮ Début ici<Key k="D" /></button>
        <span className="flex items-center gap-1 text-xs">
          <button onClick={() => save(start - 1, end)} className={nudge} aria-label="Début −1 s">−1</button>
          <b className="tabular-nums">{fmt(start)}</b>
          <button onClick={() => save(start + 1, end)} className={nudge} aria-label="Début +1 s">+1</button>
        </span>
        <span className="text-gray-300">→</span>
        <span className="flex items-center gap-1 text-xs">
          <button onClick={() => save(start, keptEnd - 1)} className={nudge} aria-label="Fin −1 s">−1</button>
          <b className="tabular-nums">{end == null ? `fin (${formatDuration(duration)})` : fmt(end)}</b>
          {end != null && <button onClick={() => save(start, end + 1)} className={nudge} aria-label="Fin +1 s">+1</button>}
        </span>
        <button onClick={setEndHere} disabled={!ready} className={btn} title="La soirée passera au titre suivant ici">Fin ici ⏭<Key k="F" /></button>
        <span className="text-[11px] text-gray-400 ml-auto tabular-nums">{fmt(r1(now))}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => play(start)} disabled={!ready} className={btn}>▶ Écouter le début</button>
        <button onClick={() => play(keptEnd - 6, end == null ? null : end)} disabled={!ready} className={btn}>▶ Écouter la fin</button>
        {trimmed && <button onClick={() => save(0, null)} className="text-xs text-gray-400 hover:text-red-600 underline">sans rognage</button>}
        {trimmed && <span className="text-xs text-fuchsia-700 font-semibold">✂️ {formatDuration(Math.round(keptEnd - start))} gardées</span>}
      </div>
      {hint === undefined ? (
        <p className="text-[11px] text-gray-400">SponsorBlock…</p>
      ) : hintUseful ? (
        <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs">
          <span className="flex-1 min-w-0">💡 SponsorBlock : début <b>{fmt(hint.start)}</b> · fin <b>{hint.end == null ? "jusqu'au bout" : fmt(hint.end)}</b></span>
          <button onClick={() => play(hint.start)} className="font-bold text-amber-800 underline">écouter</button>
          <button onClick={() => save(hint.start, hint.end, "sponsorblock")} className="font-bold bg-amber-500 text-white px-2.5 py-1 rounded-lg">Appliquer</button>
        </div>
      ) : hint ? (
        <p className="text-[11px] text-gray-400">SponsorBlock : {hint.segments ? "rien à rogner au début ni à la fin" : "aucun passage signalé"}.</p>
      ) : <p className="text-[11px] text-gray-400">SponsorBlock indisponible.</p>}
    </div>
  );
}
