"use client";
/*
 * Jukebox — télécommande (téléphone de l'organisateur), sans lecteur : la
 * musique reste jouée par la régie (PC branché à la sono).
 *  - pause / lecture / volume : ordres transmis à la régie (champ `command`,
 *    lu à chaque rafraîchissement de la régie, ~1,5 s) ;
 *  - titre suivant, file et réglages : mêmes actions que la régie.
 * L'état affiché (lecture, position, volume) vient de `playback`, envoyé par
 * la régie. Accès : jeton régie (QR « Télécommande » de la régie, #t=…) ou
 * super-admin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setAdminToken, authHeaders, formatCode } from "./storage";
import { Settings, QueueList } from "./Controls";
import { formatDuration } from "@/lib/jukebox";

export default function Telecommande({ code }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [volume, setVolume] = useState(null); // valeur du curseur pendant qu'on le bouge
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(null); // ordre envoyé, pas encore appliqué : "play" | "pause"
  const [, tick] = useState(0);
  const volumeTimer = useRef(null);

  useEffect(() => {
    const m = window.location.hash.match(/t=([a-f0-9]+)/);
    if (m) {
      setAdminToken(code, m[1]);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [code]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jukebox/${code}`, { cache: "no-store", headers: authHeaders(code) });
      if (res.status === 404) return setMissing(true);
      if (res.ok) {
        const d = await res.json();
        d.fetchedAt = Date.now();
        setData(d);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 2000);
    const t = setInterval(() => tick((n) => n + 1), 1000); // barre de progression
    return () => { clearInterval(id); clearInterval(t); };
  }, [refresh]);

  const act = useCallback(async (action, extra = {}, silent = false) => {
    const res = await fetch(`/api/jukebox/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(code) },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { if (!silent) alert(d.error || "Action impossible."); return false; }
    await refresh();
    return true;
  }, [code, refresh]);

  // l'ordre lecture/pause est considéré comme appliqué dès que la régie confirme l'état voulu
  useEffect(() => {
    const pb = data?.playback;
    if (pending && pb && data.now && pb.id === data.now.id && pb.playing === (pending === "play")) setPending(null);
  }, [data, pending]);

  if (missing) return <Center>La soirée {formatCode(code)} n'existe pas (ou plus).</Center>;
  if (!data) return <Center>Chargement…</Center>;
  if (!data.admin) {
    return (
      <Center>
        <p className="text-4xl mb-3">🔒</p>
        <p className="mb-2 font-bold">{data.session.name}</p>
        <p className="text-white/70">Scannez le QR code « Télécommande » affiché sur la régie pour piloter la soirée.</p>
      </Center>
    );
  }

  const { session, now, queue, playback: pb } = data;
  const live = pb && now && pb.id === now.id;
  const age = pb ? data.serverTime - pb.at + (Date.now() - data.fetchedAt) : Infinity;
  const regieOk = live && age < 15000; // la régie envoie son état toutes les 5 s
  const isPlaying = pending ? pending === "play" : !!(live && pb.playing);
  const pos = live ? Math.min(now.duration || Infinity, pb.pos + (pb.playing ? age / 1000 : 0)) : 0;
  const shownVolume = volume ?? pb?.volume ?? 100;

  const send = (type, value) => act("command", { type, value }, true);
  const togglePlay = () => {
    const next = isPlaying ? "pause" : "play";
    setPending(next);
    setTimeout(() => setPending(null), 6000);
    send(next);
  };
  const changeVolume = (v) => {
    setVolume(v);
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => { send("volume", v); setTimeout(() => setVolume(null), 4000); }, 300);
  };
  const skip = () => now && act("next", { from: now.id, skip: true });
  const playNow = (t) => {
    if (now && !confirm(`Lancer « ${t.title} » maintenant ?\nLe titre en cours sera interrompu.`)) return;
    act("playnow", { id: t.id });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-5">
      <div className="max-w-md mx-auto space-y-4">
        <header className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-400">📱 Télécommande</p>
            <h1 className="font-extrabold text-lg truncate">{session.name}</h1>
          </div>
          <span className="font-mono text-sm text-white/50">{formatCode(code)}</span>
        </header>

        <section className="bg-white/5 rounded-3xl p-4">
          {now ? (
            <>
              <div className="flex items-center gap-3">
                {now.thumb && <img src={now.thumb} alt="" className="w-24 h-[54px] object-cover rounded-lg shrink-0" />}
                <div className="min-w-0">
                  <p className="font-bold leading-snug line-clamp-2">{now.title}</p>
                  <p className="text-xs text-white/50">proposé par {now.author}</p>
                </div>
              </div>
              <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-fuchsia-500" style={{ width: `${now.duration ? Math.min(100, (pos / now.duration) * 100) : 0}%` }} />
              </div>
              <div className="flex justify-between text-xs text-white/40 mt-1">
                <span>{formatDuration(Math.floor(pos))}</span><span>{formatDuration(now.duration)}</span>
              </div>
            </>
          ) : (
            <p className="text-white/50 text-center py-3">Aucun titre en cours.</p>
          )}

          {now && !regieOk && (
            <p className="mt-3 text-sm text-amber-300 bg-amber-500/10 rounded-xl px-3 py-2">
              ⚠️ La régie ne répond pas : vérifiez que sa page est ouverte et que « Lancer la musique » a été cliqué.
            </p>
          )}

          <div className="flex items-center justify-center gap-5 mt-4">
            <button onClick={togglePlay} disabled={!now}
              className="w-20 h-20 rounded-full bg-fuchsia-600 active:bg-fuchsia-700 disabled:opacity-30 text-3xl" aria-label={isPlaying ? "Pause" : "Lecture"}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button onClick={skip} disabled={!now}
              className="w-14 h-14 rounded-full bg-white/10 active:bg-white/20 disabled:opacity-30 text-2xl" aria-label="Titre suivant">⏭</button>
          </div>

          <label className="flex items-center gap-3 mt-5">
            <span className="text-lg" aria-hidden>🔈</span>
            <input type="range" min={0} max={100} value={shownVolume} onChange={(e) => changeVolume(Number(e.target.value))}
              className="flex-1 accent-fuchsia-500 h-8" aria-label="Volume" />
            <span className="w-10 text-right text-sm text-white/60">{shownVolume}</span>
          </label>
        </section>

        <Link href={`/jukebox/${code}`} className="block text-center font-bold bg-fuchsia-600 active:bg-fuchsia-700 rounded-full py-3">
          + Ajouter un titre
        </Link>

        <QueueList queue={queue} act={act} playNow={playNow} />

        <section className="bg-white/5 rounded-2xl">
          <button onClick={() => setSettingsOpen((v) => !v)} className="w-full flex justify-between items-center px-4 py-3 font-bold">
            ⚙️ Réglages de la soirée <span className="text-white/50">{settingsOpen ? "▲" : "▼"}</span>
          </button>
          {settingsOpen && <div className="px-4 pb-4 space-y-3 text-sm"><Settings session={session} act={act} /></div>}
        </section>
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center text-center px-6">{children}</div>;
}
