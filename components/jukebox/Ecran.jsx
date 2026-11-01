"use client";
/*
 * Jukebox — écran d'affichage (TV, vidéoprojecteur), sans aucun réglage :
 * vidéo en cours, QR code pour proposer des titres et, si la régie l'a
 * choisi, la file à suivre. Toujours vu « comme le public » (?view=ecran,
 * sans jeton régie).
 * La vidéo est jouée en MUET (le son vient de la régie) et suit la position
 * envoyée par la régie : `playback` est horodaté par le serveur, converti en
 * heure locale grâce à `serverTime` (pas besoin d'horloges synchronisées).
 * Mode son (`sound`, télé sans PC, jeton régie sur l'appareil) : l'écran
 * joue lui-même la musique avec le moteur de la régie (usePlayerEngine) ; la
 * régie se pilote alors depuis la télécommande (téléphone).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Play } from "lucide-react";
import { formatCode, authHeaders, getAdminToken } from "./storage";
import { useAdminActions } from "./optimistic";
import { useWakeLock } from "./useWakeLock";
import { usePlayerEngine } from "./usePlayerEngine";
import { themeVars } from "@/lib/jukebox";
import { Leaderboard } from "./Blind";
import { loadYouTubeApi, createPlayer } from "./youtube";

const MAX_SHOWN = 6;

export default function Ecran({ code, sound: wantSound }) {
  const [data, setData] = useState(null);
  const [sound, setSound] = useState(null); // mode son (jeton régie présent) ; null : pas encore lu
  useEffect(() => { setSound(!!wantSound && !!getAdminToken(code)); }, [wantSound, code]);
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

  const { act, fresh, refreshRef } = useAdminActions(code, setData);
  useWakeLock(); // pas de mise en veille pendant la soirée
  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch(`/api/jukebox/${code}?view=ecran${sound ? "&engine=1" : ""}`, { cache: "no-store", headers: sound ? authHeaders(code) : {} });
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
      if (sound && !fresh(t0)) return; // action envoyée entre-temps : réponse périmée
      setData(d);
    } catch (e) { /* réseau : on retentera */ }
  }, [code, sound, fresh]);
  refreshRef.current = refresh;

  // mode son : le moteur voit le titre en cours et la file complets
  const engineData = sound && data?.engine
    ? { ...data, now: data.engine.now, queue: data.engine.queue, command: data.engine.command, admin: true } : null;
  const engine = usePlayerEngine({ code, data: engineData, act, enabled: !!sound && !!data });

  // Mode son : lancement automatique ; si le navigateur de la télé bloque le
  // son sans geste (vidéo qui ne démarre pas), on affiche le bouton « Lancer ».
  const [blocked, setBlocked] = useState(false);
  const tapped = useRef(false); // un appui a eu lieu : le son est autorisé pour la page
  useEffect(() => {
    if (sound && engine.ready && !engine.started) engine.start();
  }, [sound, engine.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sound || !engine.started) return;
    let since = null;
    const id = setInterval(() => {
      const st = engine.playerState();
      const stuck = !tapped.current && engineData?.now && (st === -1 || st === 5); // jamais démarrée (≠ pause)
      since = stuck ? since ?? Date.now() : null;
      setBlocked(!!since && Date.now() - since > 4000);
    }, 1000);
    return () => clearInterval(id);
  }, [sound, engine.started, !!engineData?.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const unlock = () => { tapped.current = true; setBlocked(false); engine.start(); };

  // Lecteur muet, sans commandes (un calque transparent bloque les clics).
  const hasData = !!data;
  useEffect(() => {
    let cancelled = false;
    if (sound !== false) return; // mode son : lecteurs du moteur
    loadYouTubeApi().then(() => {
      if (cancelled || player.current || !playerEl.current) return;
      player.current = createPlayer(playerEl.current, {
        playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1 },
        events: { onReady: (e) => { e.target.mute(); setReady(true); } },
      });
    });
    return () => { cancelled = true; };
  }, [hasData, sound]); // le conteneur n'existe qu'une fois les données chargées

  // Recalage sur la position de la régie, en douceur : petit écart → vitesse
  // légèrement modifiée (vidéo muette, invisible) ; saut seulement au-delà de
  // 3 s (chaque saut peut déclencher une pub). Si la vidéo n'avance pas alors
  // qu'elle devrait (pub, mise en mémoire), on ne force rien.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = player.current;
      const now = nowRef.current;
      if (!now || now.hidden) { // rien en cours, ou blind test pas encore dévoilé
        if (loaded.current) { p.stopVideo(); loaded.current = null; }
        return;
      }
      const s = sync.current;
      const known = s && s.id === now.id; // la régie a commencé ce titre
      const target = known ? s.pos + (s.playing ? (Date.now() - s.localAt) / 1000 : 0) : 0;
      const shouldPlay = known && s.playing;
      if (loaded.current !== `${now.id}:${now.videoId}`) { // nouveau titre, ou vidéo corrigée
        loaded.current = `${now.id}:${now.videoId}`;
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
    if (sound === null) return;
    refresh();
    const id = setInterval(refresh, sound ? 1500 : 3000); // mode son : enchaînements suivis de près
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
  if (!data || sound === null) return <Center>Chargement…</Center>;

  const { session, now, queue, total, blind } = data;
  const theme = session.theme;
  const hidden = !!now?.hidden;
  const since = (Date.now() - data.fetchedAt) / 1000;
  const joinUrl = `${origin}/jukebox/${code}`;
  const showQueue = session.screenQueue;
  const cover = now && !hidden ? `https://i.ytimg.com/vi/${now.videoId}/hqdefault.jpg` : null;
  // mode son : la vidéo reste à sa taille pendant le blind test (un lecteur
  // trop petit s'arrête), masquée par un cache
  const boxShown = sound ? !!now : now && !hidden;
  const hiddenText = (
    <>
      <p className="text-[9vw] leading-none">🕵️</p>
      <h1 className="mt-[3vh] text-[4.5vw] font-black leading-tight">Quel est ce titre ?</h1>
      <p className="mt-[1.5vh] text-[2vw] text-white/80">
        {blind?.mode === "phone" ? "Répondez sur votre téléphone : artiste, titre… ou les deux !" : "À vous de deviner !"}
      </p>
      {blind?.revealIn != null && (
        <p className="mt-[3vh] text-[5vw] font-black tabular-nums text-[var(--jb-light)]">{Math.max(0, Math.ceil(blind.revealIn - (blind.playing ? since : 0)))}</p>
      )}
    </>
  );

  return (
    <div className="relative h-screen overflow-hidden bg-gray-950 text-white select-none" style={themeVars(theme)}>
      {cover && (
        <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover scale-110 blur-3xl opacity-40" />
      )}
      <div className="absolute inset-0" style={{ background: "var(--jb-screen-bg)" }} />

      <div className="relative h-full flex flex-col lg:flex-row gap-[3vw] p-[3vw]">
        <main className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-[1.2vw] mb-[1.5vh]">
            {theme?.logo && <img src={`/api/jukebox/${code}/logo?v=${theme.logo}`} alt="" className="h-[7vh] max-w-[14vw] object-contain shrink-0" />}
            <div className="min-w-0">
              <p className="text-[1.4vw] font-bold tracking-[0.2em] uppercase text-white/70 truncate">{theme?.title || session.name}</p>
              {theme?.message && <p className="text-[1.2vw] text-white/70 line-clamp-2">{theme.message}</p>}
            </div>
          </div>
          {/* toujours monté (sinon le lecteur serait détruit), invisible sans titre */}
          <div className={boxShown ? "relative aspect-video bg-black rounded-[1.5vw] overflow-hidden shadow-2xl" : "absolute w-px h-px opacity-0 pointer-events-none overflow-hidden"}
            style={boxShown ? { width: "min(100%, calc(62vh * 16 / 9))" } : undefined}>
            {sound ? [0, 1].map((i) => (
              <div key={i} ref={engine.playerEls[i]}
                className={`absolute inset-0 transition-opacity duration-1000 ${i === engine.activeIdx ? "opacity-100 z-10" : "opacity-0"}`} />
            )) : <div ref={playerEl} className="absolute inset-0" />}
            <div className="absolute inset-0 z-20" />
            {sound && hidden && (
              <div className="absolute inset-0 z-30 bg-gray-950 flex flex-col items-center justify-center text-center">{hiddenText}</div>
            )}
          </div>
          {hidden && !sound ? (
            <div className="text-center py-[4vh]">{hiddenText}</div>
          ) : hidden ? null : now ? (
            <>
              <p className="mt-[2.5vh] flex items-center gap-[0.5vw] text-[1.2vw] font-bold uppercase tracking-wider text-[var(--jb-light)]"><Play className="w-[1vw] h-[1vw]" fill="currentColor" strokeWidth={0} />En ce moment</p>
              <h1 className="text-[2.8vw] font-black leading-tight line-clamp-2">{now.title}</h1>
              {now.channel && <p className="text-[2vw] font-semibold text-white/85 truncate">{now.channel}</p>}
              {now.videoTitle && <p className="text-[1vw] text-white/45 truncate">▶ {now.videoTitle}</p>}
              {now.author ? (
                <p className="mt-[0.5vh] text-[1.5vw] text-white/70">proposé par <span className="font-bold text-white">{now.author}</span></p>
              ) : now.revealIn ? (
                <p className="mt-[0.5vh] text-[1.5vw] text-white/70">
                  🤫 Qui a choisi ce titre ? Réponse dans <span className="font-bold text-white tabular-nums">
                    {Math.max(0, Math.ceil(now.revealIn - (Date.now() - data.fetchedAt) / 1000))} s
                  </span>
                </p>
              ) : null}
              {now.dedication && <p className="mt-[1vh] text-[1.7vw] italic text-[var(--jb-light)] line-clamp-2">💌 « {now.dedication} »</p>}
              {blind?.on && blind.mode === "phone" && (
                <p className="mt-[1.5vh] text-[1.5vw] text-white/80 line-clamp-2">
                  {blind.found?.length
                    ? <>🎯 Trouvé par {blind.found.map((f) => `${f.name}${f.artist && f.title ? "" : f.artist ? " (artiste)" : " (titre)"}`).join(", ")}</>
                    : "😮 Personne n'a trouvé !"}
                </p>
              )}
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
            <p className="mt-[1.5vh] text-[1.4vw] font-bold">{blind?.on && blind.mode === "phone" ? "Jouez au blind test" : "Proposez vos titres"}</p>
            <p className="text-[1.1vw] text-white/70 break-all">{joinUrl.replace(/^https?:\/\//, "")}</p>
            <p className="text-[1.1vw] text-white/70">code <span className="font-mono font-black text-white text-[2vw]">{formatCode(code)}</span></p>
          </div>

          {blind?.on && blind.mode === "phone" ? (
            <div className="flex-1 min-h-0 bg-white/10 backdrop-blur rounded-[1.5vw] p-[1.5vw] overflow-hidden">
              {blind.top?.length ? <Leaderboard top={blind.top} big /> : <p className="text-[1.4vw] text-white/70">🏆 Le classement s'affichera dès les premières bonnes réponses.</p>}
            </div>
          ) : blind?.on ? null : showQueue ? (
            <div className="flex-1 min-h-0 bg-white/10 backdrop-blur rounded-[1.5vw] p-[1.5vw] overflow-hidden">
              <h2 className="text-[1.5vw] font-bold mb-[1.5vh]">À suivre {total > 0 && <span className="text-white/50 font-normal">({total})</span>}</h2>
              {queue.length === 0 ? (
                <p className="text-[1.2vw] text-white/60">La file est vide.</p>
              ) : (
                <ol className="space-y-[1.2vh]">
                  {queue.slice(0, MAX_SHOWN).map((t, i) => (
                    <li key={t.id} className="flex items-center gap-[1vw]">
                      <span className="w-[2vw] text-right text-[1.4vw] font-black text-[var(--jb-light)] shrink-0">{i + 1}</span>
                      {t.thumb && <img src={t.thumb} alt="" className="w-[5vw] aspect-video object-cover rounded-[0.4vw] shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-[1.15vw] font-semibold truncate">{t.title}</p>
                        <p className="text-[0.95vw] text-white/60 truncate">{[t.channel, t.author && `proposé par ${t.author}`].filter(Boolean).join(" · ")}</p>
                        {t.dedication && <p className="text-[0.95vw] text-[var(--jb-light)] italic truncate">💌 « {t.dedication} »</p>}
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

      {sound && (!engine.started || blocked) && (
        <div className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-[3vh] text-center px-6">
          <p className="text-[2vw] text-white/80">🔊 Cette télé joue la musique de la soirée.</p>
          <button autoFocus onClick={unlock} disabled={!engine.ready}
            className="bg-fuchsia-600 hover:bg-fuchsia-700 focus:ring-8 focus:ring-white outline-none disabled:opacity-40 text-white text-[2.5vw] font-bold px-[4vw] py-[2vh] rounded-full">
            {engine.ready ? "▶ Lancer la musique" : "Chargement du lecteur…"}
          </button>
          <p className="text-[1.3vw] text-white/60">Appuyez sur OK avec la télécommande de la télé. Ensuite, tout se pilote depuis la télécommande du téléphone.</p>
        </div>
      )}

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
