"use client";
/*
 * Jukebox — écran d'affichage (TV, vidéoprojecteur), sans aucun réglage :
 * vidéo en cours, QR code pour proposer des titres et, si la régie l'a
 * choisi, la file à suivre. Toujours vu « comme le public » (?view=ecran,
 * sans jeton régie).
 * La vidéo est jouée en MUET (le son vient de la régie) et suit la position
 * envoyée par la régie : `playback` est horodaté par le serveur, converti en
 * heure locale grâce à `serverTime` (pas besoin d'horloges synchronisées).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCode } from "./storage";
import { loadYouTubeApi, createPlayer } from "./youtube";

const MAX_SHOWN = 6;

export default function Ecran({ code }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [mouseActive, setMouseActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [, tick] = useState(0); // compte à rebours avant de révéler le nom
  const player = useRef(null);
  const playerEl = useRef(null);
  const loaded = useRef(null); // id du titre chargé dans le lecteur
  const nowRef = useRef(null);
  const sync = useRef(null); // { id, pos, playing, at, localAt }
  const clock = useRef(null); // { offset: heure serveur − heure locale, rtt }
  const progress = useRef(null); // { cur, t } : la vidéo avance-t-elle vraiment ?

  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch(`/api/jukebox/${code}?view=ecran`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (!res.ok) return;
      const d = await res.json();
      const t1 = Date.now();
      // Écart d'horloge estimé au milieu de l'aller-retour ; on garde la mesure
      // la plus fiable (aller-retour le plus court), renouvelée de temps en temps.
      const rtt = t1 - t0;
      const c = clock.current;
      if (!c || rtt <= c.rtt * 1.2 || t1 - c.t > 60000) clock.current = { offset: d.serverTime - (t0 + t1) / 2, rtt, t: t1 };
      const pb = d.playback;
      if (!pb) sync.current = null;
      else if (sync.current?.at !== pb.at || !c) // nouvelle position envoyée par la régie
        sync.current = { id: pb.id, pos: pb.pos, playing: pb.playing, at: pb.at, localAt: pb.at - clock.current.offset };
      nowRef.current = d.now;
      d.fetchedAt = Date.now();
      setData(d);
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  // Lecteur muet, sans commandes (un calque transparent bloque les clics).
  const hasData = !!data;
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || player.current || !playerEl.current) return;
      player.current = createPlayer(playerEl.current, {
        playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1 },
        events: { onReady: (e) => { e.target.mute(); setReady(true); } },
      });
    });
    return () => { cancelled = true; };
  }, [hasData]); // le conteneur n'existe qu'une fois les données chargées

  // Recalage sur la position de la régie, en douceur : petit écart → vitesse
  // légèrement modifiée (vidéo muette, invisible) ; saut seulement au-delà de
  // 3 s (chaque saut peut déclencher une pub). Si la vidéo n'avance pas alors
  // qu'elle devrait (pub, mise en mémoire), on ne force rien.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = player.current;
      const now = nowRef.current;
      if (!now) {
        if (loaded.current) { p.stopVideo(); loaded.current = null; }
        return;
      }
      const s = sync.current;
      const known = s && s.id === now.id; // la régie a commencé ce titre
      const target = known ? s.pos + (s.playing ? (Date.now() - s.localAt) / 1000 : 0) : 0;
      const shouldPlay = known && s.playing;
      if (loaded.current !== now.id) {
        loaded.current = now.id;
        p.loadVideoById({ videoId: now.videoId, startSeconds: target });
        return;
      }
      const state = p.getPlayerState();
      if (state === 3) return; // chargement en cours
      const cur = p.getCurrentTime();
      const t = Date.now();
      const prev = progress.current;
      progress.current = { cur, t };
      if (!shouldPlay) {
        if (state === 1) p.pauseVideo();
        if (Math.abs(cur - target) > 0.5) p.seekTo(target, true);
        return;
      }
      if (state !== 1) { p.playVideo(); return; }
      const stalled = prev && t - prev.t < 2000 && cur - prev.cur < 0.1;
      if (stalled) return;
      const drift = cur - target; // > 0 : l'écran est en avance
      if (Math.abs(drift) > 3) { p.setPlaybackRate(1); p.seekTo(target, true); }
      else if (Math.abs(drift) > 0.25) p.setPlaybackRate(drift < 0 ? 1.25 : 0.75);
      else if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1);
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Bouton bien visible hors plein écran ; en plein écran, il n'apparaît que
  // quelques secondes quand on bouge la souris (pour pouvoir en sortir).
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    let timer;
    const onMove = () => {
      setMouseActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setMouseActive(false), 3000);
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("mousemove", onMove);
      clearTimeout(timer);
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };

  if (missing) return <Center>La soirée {formatCode(code)} n'existe pas (ou plus).</Center>;
  if (!data) return <Center>Chargement…</Center>;

  const { session, now, queue, total } = data;
  const joinUrl = `${origin}/jukebox/${code}`;
  const showQueue = session.screenQueue;
  const cover = now ? `https://i.ytimg.com/vi/${now.videoId}/hqdefault.jpg` : null;

  return (
    <div className="relative h-screen overflow-hidden bg-gray-950 text-white select-none">
      {cover && (
        <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover scale-110 blur-3xl opacity-40" />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-900/40 via-transparent to-indigo-950/70" />

      <div className="relative h-full flex flex-col lg:flex-row gap-[3vw] p-[3vw]">
        <main className="flex-1 min-w-0 flex flex-col justify-center">
          <p className="text-[1.4vw] font-bold tracking-[0.2em] uppercase text-white/60 mb-[1.5vh]">{session.name}</p>
          {/* toujours monté (sinon le lecteur serait détruit), invisible sans titre */}
          <div className={now ? "relative aspect-video bg-black rounded-[1.5vw] overflow-hidden shadow-2xl" : "absolute w-px h-px opacity-0 pointer-events-none overflow-hidden"}
            style={now ? { width: "min(100%, calc(62vh * 16 / 9))" } : undefined}>
            <div ref={playerEl} className="absolute inset-0" />
            <div className="absolute inset-0" />
          </div>
          {now ? (
            <>
              <p className="mt-[2.5vh] text-[1.2vw] font-bold uppercase tracking-wider text-fuchsia-300">▶ En ce moment</p>
              <h1 className="text-[2.8vw] font-black leading-tight line-clamp-2">{now.title}</h1>
              {now.author ? (
                <p className="mt-[0.5vh] text-[1.5vw] text-white/70">proposé par <span className="font-bold text-white">{now.author}</span></p>
              ) : now.revealIn ? (
                <p className="mt-[0.5vh] text-[1.5vw] text-white/70">
                  🤫 Qui a choisi ce titre ? Réponse dans <span className="font-bold text-white tabular-nums">
                    {Math.max(0, Math.ceil(now.revealIn - (Date.now() - data.fetchedAt) / 1000))} s
                  </span>
                </p>
              ) : null}
              {now.dedication && <p className="mt-[1vh] text-[1.7vw] italic text-fuchsia-200 line-clamp-2">💌 « {now.dedication} »</p>}
            </>
          ) : (
            <>
              <p className="text-[7vw] leading-none">🎶</p>
              <h1 className="mt-[2vh] text-[4vw] font-black leading-tight">Le jukebox attend vos titres !</h1>
              <p className="mt-[1vh] text-[1.8vw] text-white/70">Scannez le QR code pour proposer une chanson.</p>
            </>
          )}
        </main>

        <aside className={`shrink-0 flex flex-col gap-[3vh] ${showQueue ? "lg:w-[30vw]" : "lg:w-[32vw] justify-center"}`}>
          <div className="bg-white/10 backdrop-blur rounded-[1.5vw] p-[1.5vw] flex flex-col items-center text-center">
            {origin && (
              <div className={`bg-white p-[0.8vw] rounded-[1vw] ${showQueue ? "w-[min(16vw,30vh)]" : "w-[min(26vw,52vh)]"}`}>
                <QRCodeSVG value={joinUrl} size={512} style={{ width: "100%", height: "auto" }} fgColor="#0f172a" />
              </div>
            )}
            <p className="mt-[1.5vh] text-[1.4vw] font-bold">Proposez vos titres</p>
            <p className="text-[1.1vw] text-white/70 break-all">{joinUrl.replace(/^https?:\/\//, "")}</p>
            <p className="text-[1.1vw] text-white/70">code <span className="font-mono font-black text-white text-[2vw]">{formatCode(code)}</span></p>
          </div>

          {showQueue ? (
            <div className="flex-1 min-h-0 bg-white/10 backdrop-blur rounded-[1.5vw] p-[1.5vw] overflow-hidden">
              <h2 className="text-[1.5vw] font-bold mb-[1.5vh]">À suivre {total > 0 && <span className="text-white/50 font-normal">({total})</span>}</h2>
              {queue.length === 0 ? (
                <p className="text-[1.2vw] text-white/60">La file est vide.</p>
              ) : (
                <ol className="space-y-[1.2vh]">
                  {queue.slice(0, MAX_SHOWN).map((t, i) => (
                    <li key={t.id} className="flex items-center gap-[1vw]">
                      <span className="w-[2vw] text-right text-[1.4vw] font-black text-fuchsia-300 shrink-0">{i + 1}</span>
                      {t.thumb && <img src={t.thumb} alt="" className="w-[5vw] aspect-video object-cover rounded-[0.4vw] shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-[1.15vw] font-semibold truncate">{t.title}</p>
                        {t.author && <p className="text-[0.95vw] text-white/60 truncate">{t.author}</p>}
                        {t.dedication && <p className="text-[0.95vw] text-fuchsia-200 italic truncate">💌 « {t.dedication} »</p>}
                      </div>
                    </li>
                  ))}
                  {total > MAX_SHOWN && <li className="text-[1vw] text-white/50 pl-[3vw]">… et {total - MAX_SHOWN} autre{total - MAX_SHOWN > 1 ? "s" : ""}</li>}
                </ol>
              )}
            </div>
          ) : total > 0 && (
            <p className="text-center text-[1.4vw] text-white/70">{total} titre{total > 1 ? "s" : ""} à suivre</p>
          )}
        </aside>
      </div>

      <button onClick={toggleFullscreen}
        className={`absolute bottom-4 right-4 bg-black/50 hover:bg-black/70 backdrop-blur text-white font-bold px-5 py-2.5 rounded-full border border-white/20 transition-opacity duration-500 ${
          !fullscreen || mouseActive ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {fullscreen ? "✕ Quitter le plein écran" : "⛶ Plein écran"}
      </button>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen bg-gray-950 text-white/80 flex items-center justify-center text-center px-6">{children}</div>;
}
