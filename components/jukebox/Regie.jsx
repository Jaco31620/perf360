"use client";
/*
 * Jukebox — régie (PC branché à la sono, ou TV). Joue la file avec le lecteur
 * YouTube intégré et enchaîne tout seul : le titre suivant est préchargé dans
 * un 2e lecteur, puis fondu enchaîné (durée réglable) ou passage direct à la
 * fin du titre ; s'il ne peut pas être lu, on demande le suivant au serveur. Rafraîchit la file toutes
 * les 2 s. Jeton régie en localStorage, ou #t=… dans l'URL pour ouvrir la
 * régie sur un autre appareil.
 * Les navigateurs bloquent le son sans geste de l'utilisateur : la lecture
 * démarre au clic sur « Lancer la musique ».
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { loadYouTubeApi, createPlayer } from "./youtube";
import { getAdminToken, setAdminToken, authHeaders, rememberParty, forgetParty, formatCode } from "./storage";
import { Settings, QueueList, PlayPauseButton, SkipButton, VolumeSlider, FixVideoButton, VideoPicker } from "./Controls";
import { Play } from "lucide-react";
import History from "./History";
import { BlindPanel } from "./Blind";

export default function Regie({ code }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [activeIdx, setActiveIdx] = useState(0); // lecteur visible
  const [bigQr, setBigQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remoteQr, setRemoteQr] = useState(false);
  const [fixing, setFixing] = useState(null); // titre dont on corrige la vidéo
  const [historyOpen, setHistoryOpen] = useState(false);
  const [peek, setPeek] = useState(null); // blind test : titre affiché quand même en régie
  const [tab, setTab] = useState("queue"); // onglet de la colonne de droite (retenu par appareil)
  useEffect(() => { try { const t = localStorage.getItem("jukebox:regieTab"); if (t) setTab(t); } catch (e) { /* ignoré */ } }, []);
  const chooseTab = (t) => { setTab(t); try { localStorage.setItem("jukebox:regieTab", t); } catch (e) { /* ignoré */ } };
  const token = useRef(null);
  // Deux lecteurs qui se relaient : l'actif joue, l'autre précharge le titre
  // suivant (sans blanc entre les titres) et sert au fondu enchaîné.
  const players = useRef([null, null]);
  const playerEls = [useRef(null), useRef(null)];
  const active = useRef(0);
  const primed = useRef(null); // { id, idx, ready } : titre suivant préchargé
  const fading = useRef(false);
  // Bascule locale vers le titre suivant pas encore confirmée par le serveur :
  // { from, to, until }. D'ici là, une réponse qui annonce encore `from` en
  // cours est périmée et ne doit pas toucher aux lecteurs.
  const switching = useRef(null);
  const master = useRef(100); // volume choisi
  const loaded = useRef(null); // id du titre joué par le lecteur actif
  const loadedVideo = useRef(null); // sa vidéo (peut être corrigée en cours de soirée)
  const advancing = useRef(false);
  const dataRef = useRef(null);
  dataRef.current = data;

  const cur = () => players.current[active.current];
  const other = () => players.current[1 - active.current];

  useEffect(() => {
    const m = window.location.hash.match(/t=([a-f0-9]+)/);
    if (m) {
      setAdminToken(code, m[1]);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    token.current = getAdminToken(code);
    setOrigin(window.location.origin);
  }, [code]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jukebox/${code}`, {
        cache: "no-store",
        headers: authHeaders(code),
      });
      if (res.status === 404) return setMissing(true);
      if (res.ok) {
        const d = await res.json();
        d.fetchedAt = Date.now();
        setData(d);
        if (d.admin) rememberParty(code, d.session.name);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
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

  const advance = useCallback(async (skip, from = loaded.current) => {
    if (advancing.current) return;
    advancing.current = true;
    try { await act("next", { from, skip }, true); } finally { advancing.current = false; }
  }, [act]);

  // Position de lecture transmise à l'écran d'affichage (qui suit en muet) :
  // à chaque lecture / pause et toutes les 5 s.
  const report = useCallback(() => {
    const p = players.current[active.current];
    if (!loaded.current || !p?.getCurrentTime) return;
    fetch(`/api/jukebox/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(code) },
      body: JSON.stringify({ action: "playback", id: loaded.current, pos: p.getCurrentTime(), playing: p.getPlayerState() === 1, volume: master.current }),
    }).catch(() => {});
  }, [code]);

  useEffect(() => {
    if (!started) return;
    const id = setInterval(report, 5000);
    return () => clearInterval(id);
  }, [started, report]);

  const setActive = (i) => { active.current = i; setActiveIdx(i); };

  const dropPrimed = () => {
    if (!primed.current) return;
    players.current[primed.current.idx]?.stopVideo();
    primed.current = null;
  };

  // Le titre préchargé devient le titre actif, avec ou sans fondu.
  const switchToPrimed = (fadeSec) => {
    const pr = primed.current;
    const oldP = cur();
    const newP = players.current[pr.idx];
    primed.current = null;
    switching.current = { from: loaded.current, to: pr.id, until: Date.now() + 15000 };
    loaded.current = pr.id;
    loadedVideo.current = pr.videoId;
    setActive(pr.idx);
    newP.seekTo(0, true);
    newP.playVideo();
    if (!fadeSec) {
      oldP.stopVideo();
      newP.setVolume(master.current);
      return;
    }
    fading.current = true;
    const t0 = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / (fadeSec * 1000));
      newP.setVolume(Math.round(master.current * k));
      oldP.setVolume(Math.round(master.current * (1 - k)));
      if (k >= 1) {
        clearInterval(id);
        oldP.stopVideo();
        oldP.setVolume(master.current);
        fading.current = false;
      }
    }, 100);
  };

  // Les événements des lecteurs sont branchés une fois : ils passent par une ref.
  const onEvent = useRef({});
  onEvent.current = {
    state: (i, e) => {
      if (i === active.current) {
        setPlaying(e.data === 1);
        if (e.data === 0 && !fading.current) { // terminé
          // suivant déjà préchargé : on enchaîne tout de suite, sans attendre le serveur
          if (primed.current?.ready && primed.current.id === dataRef.current?.queue?.[0]?.id) {
            const from = loaded.current;
            switchToPrimed(0);
            advance(false, from);
          } else advance(false);
        }
        if (e.data === 1 || e.data === 2) report(); // lecture / pause → écran
      } else if (primed.current?.idx === i && !primed.current.ready && e.data === 1) {
        // préchargé : on le met en attente au début, en silence
        e.target.pauseVideo();
        e.target.seekTo(0, true);
        primed.current.ready = true;
      }
    },
    error: (i) => {
      if (i === active.current) advance(true); // lecture bloquée, vidéo retirée…
      else if (primed.current?.idx === i) primed.current = null;
    },
  };

  // Lecteurs YouTube (IFrame API)
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || players.current[0] || !playerEls[0].current) return;
      let readyCount = 0;
      players.current = [0, 1].map((i) => createPlayer(playerEls[i].current, {
        playerVars: { autoplay: 0, rel: 0, playsinline: 1 },
        events: {
          onReady: () => { if (++readyCount === 2) setReady(true); },
          onStateChange: (e) => onEvent.current.state(i, e),
          onError: () => onEvent.current.error(i),
        },
      }));
    });
    return () => { cancelled = true; };
  }, [data?.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronise les lecteurs avec le titre en cours côté serveur.
  useEffect(() => {
    if (!started || !ready || !data) return;
    const now = data.now;
    const sw = switching.current;
    if (sw) {
      if (now?.id === sw.from && Date.now() < sw.until) return; // réponse périmée
      switching.current = null;
    }
    if (now && (loaded.current !== now.id || loadedVideo.current !== now.videoId)) {
      if (primed.current?.id === now.id && primed.current.videoId === now.videoId && primed.current.ready) return switchToPrimed(0);
      dropPrimed();
      other()?.stopVideo();
      loaded.current = now.id;
      loadedVideo.current = now.videoId;
      cur().setVolume(master.current);
      cur().loadVideoById(now.videoId);
    } else if (!now) {
      if (loaded.current) { cur().stopVideo(); loaded.current = null; }
      dropPrimed();
      if (data.queue.length) advance(false);
    }
  }, [data, started, ready, advance]); // eslint-disable-line react-hooks/exhaustive-deps

  // Préchargement du titre suivant, puis fondu enchaîné sur la fin du titre.
  // La fin est calculée avec la durée du titre (pas celle d'une éventuelle pub).
  useEffect(() => {
    if (!started || !ready) return;
    const id = setInterval(() => {
      const d = dataRef.current;
      const now = d?.now;
      const next = d?.queue?.[0];
      const p = cur();
      if (!now || fading.current || loaded.current !== now.id || p.getPlayerState() !== 1) return;
      if (!next) { dropPrimed(); return; }
      const fadeSec = d.session.fade;
      const rem = (now.duration || p.getDuration()) - p.getCurrentTime();
      if (primed.current && (primed.current.id !== next.id || primed.current.videoId !== next.videoId)) dropPrimed(); // file réordonnée, vidéo corrigée
      if (!primed.current) {
        if (rem <= fadeSec + 10) {
          const idx = 1 - active.current;
          primed.current = { id: next.id, videoId: next.videoId, idx, ready: false };
          players.current[idx].setVolume(0);
          players.current[idx].loadVideoById(next.videoId);
        }
        return;
      }
      if (fadeSec > 0 && primed.current.ready && rem <= fadeSec) {
        const from = loaded.current;
        switchToPrimed(fadeSec);
        advance(false, from); // le serveur passe au titre suivant (écran, invités)
      }
    }, 250);
    return () => clearInterval(id);
  }, [started, ready, advance]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reprise après rechargement : le titre en cours repart là où la régie en
  // était (dernière position envoyée, + temps écoulé s'il était en lecture).
  const resumeAt = (d) => {
    const pb = d.playback;
    if (!pb || pb.id !== d.now.id) return 0;
    const elapsed = pb.playing ? (d.serverTime - pb.at + (Date.now() - d.fetchedAt)) / 1000 : 0;
    const pos = pb.pos + elapsed;
    return d.now.duration && pos > d.now.duration - 3 ? 0 : Math.max(0, pos);
  };

  const start = () => {
    setStarted(true);
    // dans le geste du clic : le navigateur autorise le son
    if (data?.now) {
      loaded.current = data.now.id;
      loadedVideo.current = data.now.videoId;
      cur().loadVideoById({ videoId: data.now.videoId, startSeconds: resumeAt(data) });
    }
  };

  const playNow = (t) => {
    if (data.now && !confirm(`Lancer « ${t.title} » maintenant ?\nLe titre en cours sera interrompu.`)) return;
    act("playnow", { id: t.id });
  };

  const togglePlay = () => (playing ? cur()?.pauseVideo() : cur()?.playVideo());
  const volumeReport = useRef(null);
  const changeVolume = (v) => {
    setVolume(v);
    master.current = v;
    if (!fading.current) cur()?.setVolume(v);
    clearTimeout(volumeReport.current);
    volumeReport.current = setTimeout(report, 400); // la télécommande affiche le volume
  };

  // Ordres de la télécommande. Celui déjà présent à l'ouverture est ignoré.
  const lastCommand = useRef(undefined);
  useEffect(() => {
    if (!data?.admin) return;
    const c = data.command;
    if (lastCommand.current === undefined) { lastCommand.current = c?.id ?? null; return; }
    if (!c || c.id === lastCommand.current) return;
    lastCommand.current = c.id;
    if (!started || !ready) return;
    if (c.type === "pause") cur().pauseVideo();
    else if (c.type === "play") cur().playVideo();
    else if (c.type === "volume") changeVolume(c.value);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blind test : titre suivant N s après la réponse dévoilée (réglage « Titre suivant »).
  const blindNext = useRef(null);
  useEffect(() => {
    const b = data?.blind;
    const now = data?.now;
    if (!started || !b?.on || !now || !b.revealed || !b.after || blindNext.current === now.id) return;
    if (b.revealedFor >= b.after) { blindNext.current = now.id; advance(false, now.id); }
  }, [data, started, advance]);

  const copyRegieLink = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/jukebox/${code}/regie#t=${token.current}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { alert("Copie impossible."); }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };

  if (missing) {
    return (
      <Center>
        <p className="text-4xl mb-3">🤔</p>
        <p className="mb-6">La soirée {formatCode(code)} n'existe pas (ou plus).</p>
        <Link href="/jukebox" className="bg-fuchsia-600 text-white font-bold px-6 py-3 rounded-full">Retour</Link>
      </Center>
    );
  }
  if (!data) return <Center>Chargement…</Center>;
  if (!data.admin) {
    return (
      <Center>
        <p className="text-4xl mb-3">🔒</p>
        <p className="mb-2 font-bold text-xl">{data.session.name}</p>
        <p className="mb-6 text-white/70">Cette page est réservée à la régie de la soirée.</p>
        <Link href={`/jukebox/${code}`} className="bg-fuchsia-600 text-white font-bold px-6 py-3 rounded-full">Proposer un titre</Link>
      </Center>
    );
  }

  const { session, now, queue } = data;
  const open = session.status === "open";
  const masked = !!(data.blind?.on && now && !data.blind.revealed && peek !== now.id);
  const tabs = [
    { id: "queue", label: `🎵 File${queue.length ? ` (${queue.length})` : ""}` },
    { id: "settings", label: "⚙️ Réglages" },
    ...(session.blindSettings ? [{ id: "blind", label: "🕵️ Blind", dot: session.blindSettings.on }] : []),
    { id: "tools", label: "🔧 Outils" },
  ];
  const shown = tabs.some((t) => t.id === tab) ? tab : "queue"; // onglet retiré (blind test coupé)
  const joinUrl = `${origin}/jukebox/${code}`;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-white/10">
        <Link href="/jukebox" className="text-white/60 hover:text-white text-sm">← Jukebox</Link>
        <h1 className="font-extrabold text-lg truncate flex-1 min-w-0">{session.name}</h1>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${open ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/60"}`}>
          {open ? "Ajouts des invités autorisés" : "Ajouts des invités bloqués"}
        </span>
        <button onClick={toggleFullscreen} className="text-sm text-white/70 hover:text-white">⛶ Plein écran</button>
      </header>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_380px]">
        <main className="min-w-0">
          <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden">
            {[0, 1].map((i) => (
              <div key={i} ref={playerEls[i]}
                className={`absolute transition-opacity duration-1000 ${started && masked ? "right-2 top-2 w-[356px] h-[200px] rounded-lg overflow-hidden" : "inset-0"} ${i === activeIdx ? `opacity-100 ${started && masked ? "z-30" : "z-10"}` : "opacity-0 pointer-events-none"}`} />
            ))}
            {!started && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 text-center px-6">
                <p className="text-white/70">
                  {now || queue.length ? `${queue.length + (now ? 1 : 0)} titre${queue.length + (now ? 1 : 0) > 1 ? "s" : ""} dans la file` : "La file est vide pour l'instant : la musique démarrera au premier titre proposé."}
                </p>
                <button onClick={start} disabled={!ready}
                  className="bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white text-xl font-bold px-8 py-4 rounded-full">
                  {ready ? <span className="inline-flex items-center gap-2"><Play size={22} fill="currentColor" strokeWidth={0} />{now ? "Reprendre la musique" : "Lancer la musique"}</span> : "Chargement du lecteur…"}
                </button>
              </div>
            )}
            {started && masked && (
              // Miniature en haut à droite, jamais sous 356×200 (en dessous, ou
              // entièrement recouvert, le lecteur YouTube peut rester bloqué).
              <div className="absolute inset-0 z-20 flex flex-col items-start justify-end gap-1 bg-gray-950 p-3 text-sm">
                <p className="text-white/70">🕵️ Blind test : écran masqué jusqu'à la réponse.</p>
                <button onClick={() => setPeek(now.id)} className="text-white/50 underline">Afficher en grand (régie)</button>
              </div>
            )}
            {started && !now && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black text-white/60 text-center px-6 pointer-events-none">
                En attente du prochain titre… Scannez le QR code pour en proposer un !
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-0">
              {now ? (
                <>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-fuchsia-400 uppercase tracking-wider"><Play size={12} fill="currentColor" strokeWidth={0} />En ce moment · proposé par {now.author}</p>
                  <p className="text-xl font-bold truncate">{masked ? "🤫 Titre masqué" : now.title}</p>
                  <p className="text-sm text-white/50">{masked ? "Blind test en cours" : now.channel} <span className="ml-2"><FixVideoButton onClick={() => setFixing(now)} /></span></p>
                  {now.dedication && (
                    <p className="text-sm text-fuchsia-300 italic mt-1">
                      💌 « {now.dedication} »
                      <button onClick={() => confirm("Effacer cette dédicace ?") && act("clearDedication", { id: now.id })}
                        className="not-italic ml-2 text-white/40 hover:text-red-400" aria-label="Effacer la dédicace">✕</button>
                    </p>
                  )}
                </>
              ) : <p className="text-white/50">Aucun titre en cours.</p>}
            </div>
            {started && (
              <div className="flex items-center gap-3">
                <PlayPauseButton playing={playing} onClick={togglePlay} disabled={!now} />
                <SkipButton onClick={() => advance(true)} disabled={!now} />
                <VolumeSlider value={volume} onChange={changeVolume} className="w-36 ml-1" />
              </div>
            )}
          </div>
        </main>

        <aside className="space-y-4 min-w-0">
          <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-3">
            {origin && (
              <button onClick={() => setBigQr(true)} className="bg-white p-1 rounded-lg shrink-0" aria-label="Agrandir le QR code">
                <QRCodeSVG value={joinUrl} size={64} fgColor="#0f172a" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/60">Proposez vos titres :</p>
              <p className="font-bold text-sm break-all">{joinUrl.replace(/^https?:\/\//, "")}</p>
              <p className="text-xs text-white/60">code <span className="font-mono font-bold text-white text-base">{formatCode(code)}</span></p>
            </div>
            <Link href={`/jukebox/${code}`} target="_blank" className="shrink-0 font-bold text-sm bg-fuchsia-600 hover:bg-fuchsia-700 rounded-full px-3 py-2">
              + Titre
            </Link>
          </div>

          {/* onglets : la file reste à portée, les réglages ne l'écrasent plus */}
          <div className="flex bg-white/5 rounded-full p-1 text-sm">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => chooseTab(t.id)}
                className={`relative flex-1 px-2 py-1.5 rounded-full font-bold whitespace-nowrap ${shown === t.id ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>
                {t.label}
                {t.dot && <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-green-400" />}
              </button>
            ))}
          </div>

          {shown === "queue" && (
            <>
              <QueueList queue={queue} act={act} playNow={playNow} onFixVideo={setFixing} />
              {session.features.history && (
                <button onClick={() => setHistoryOpen(true)} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-full py-2 text-sm">
                  🕘 Historique de la soirée
                </button>
              )}
            </>
          )}

          {shown === "settings" && (
            <div className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
              <Settings session={session} act={act} />
            </div>
          )}

          {shown === "blind" && session.blindSettings && <BlindPanel settings={session.blindSettings} blind={data.blind} now={now} act={act} />}

          {shown === "tools" && (
            <div className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
              {token.current && (
                <button onClick={() => setRemoteQr(true)} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">
                  📱 Télécommande sur téléphone
                </button>
              )}
              <Link href={`/jukebox/${code}/ecran`} target="_blank" className="block text-center font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">
                📺 Ouvrir l'écran d'affichage
              </Link>
              {token.current && (
                <button onClick={copyRegieLink} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">
                  {copied ? "✓ Lien copié" : "🔗 Copier le lien régie (autre appareil)"}
                </button>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2 border-t border-white/10 text-xs text-white/50">
                <button onClick={() => confirm("Vider la file et arrêter le titre en cours ?") && act("reset")} className="hover:text-white">Vider la file</button>
                <button onClick={async () => {
                  if (!confirm("Supprimer définitivement cette soirée ?")) return;
                  if (await act("delete")) { forgetParty(code); router.push("/jukebox"); }
                }} className="hover:text-red-400">Supprimer la soirée</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {fixing && <VideoPicker code={code} track={fixing} onClose={() => setFixing(null)} onDone={refresh} mute />}
      {historyOpen && <History code={code} name={session.name} onClose={() => setHistoryOpen(false)} onChanged={refresh} />}

      {remoteQr && (
        <div onClick={() => setRemoteQr(false)} className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-5 p-6 cursor-pointer text-center">
          <p className="text-2xl font-bold">📱 Télécommande</p>
          <div className="bg-white p-4 rounded-3xl"><QRCodeSVG value={`${origin}/jukebox/${code}/telecommande#t=${token.current}`} size={280} /></div>
          <p className="text-white/70 max-w-sm">Scannez avec votre téléphone pour piloter la soirée : lecture, volume, file et réglages.</p>
          <p className="text-amber-300 text-sm max-w-sm">⚠️ Ce QR code donne le contrôle de la soirée : ne le montrez pas aux invités.</p>
        </div>
      )}

      {bigQr && (
        <div onClick={() => setBigQr(false)} className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-6 p-6 cursor-pointer">
          <div className="bg-white p-5 rounded-3xl"><QRCodeSVG value={joinUrl} size={360} /></div>
          <p className="text-2xl font-bold">{joinUrl.replace(/^https?:\/\//, "")}</p>
          <p className="text-white/60">code <span className="font-mono font-bold text-white text-3xl">{formatCode(code)}</span></p>
        </div>
      )}
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center text-center px-6">{children}</div>;
}
