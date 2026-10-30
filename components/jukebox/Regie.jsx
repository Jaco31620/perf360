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
import { getAdminToken, setAdminToken, rememberParty, forgetParty, formatCode } from "./storage";
import { MAX_CHOICES, SEARCH_MODES, FADE_CHOICES, maxLabel, formatDuration } from "@/lib/jukebox";

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
  const token = useRef(null);
  // Deux lecteurs qui se relaient : l'actif joue, l'autre précharge le titre
  // suivant (sans blanc entre les titres) et sert au fondu enchaîné.
  const players = useRef([null, null]);
  const playerEls = [useRef(null), useRef(null)];
  const active = useRef(0);
  const primed = useRef(null); // { id, idx, ready } : titre suivant préchargé
  const fading = useRef(false);
  const master = useRef(100); // volume choisi
  const loaded = useRef(null); // id du titre joué par le lecteur actif
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
        headers: token.current ? { "x-jukebox-admin": token.current } : {},
      });
      if (res.status === 404) return setMissing(true);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (d.admin) rememberParty(code, d.session.name);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const act = useCallback(async (action, extra = {}, silent = false) => {
    const res = await fetch(`/api/jukebox/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-jukebox-admin": token.current || "" },
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
      headers: { "Content-Type": "application/json", "x-jukebox-admin": token.current || "" },
      body: JSON.stringify({ action: "playback", id: loaded.current, pos: p.getCurrentTime(), playing: p.getPlayerState() === 1 }),
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
    loaded.current = pr.id;
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
    if (now && loaded.current !== now.id) {
      if (primed.current?.id === now.id && primed.current.ready) return switchToPrimed(0);
      dropPrimed();
      other()?.stopVideo();
      loaded.current = now.id;
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
      if (primed.current && primed.current.id !== next.id) dropPrimed(); // file réordonnée
      if (!primed.current) {
        if (rem <= fadeSec + 10) {
          const idx = 1 - active.current;
          primed.current = { id: next.id, idx, ready: false };
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

  const start = () => {
    setStarted(true);
    // dans le geste du clic : le navigateur autorise le son
    if (data?.now) {
      loaded.current = data.now.id;
      cur().loadVideoById(data.now.videoId);
    }
  };

  const togglePlay = () => (playing ? cur()?.pauseVideo() : cur()?.playVideo());
  const changeVolume = (v) => {
    setVolume(v);
    master.current = v;
    if (!fading.current) cur()?.setVolume(v);
  };

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
                className={`absolute inset-0 transition-opacity duration-1000 ${i === activeIdx ? "opacity-100 z-10" : "opacity-0 pointer-events-none"}`} />
            ))}
            {!started && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 text-center px-6">
                <p className="text-white/70">
                  {now || queue.length ? `${queue.length + (now ? 1 : 0)} titre${queue.length + (now ? 1 : 0) > 1 ? "s" : ""} dans la file` : "La file est vide pour l'instant : la musique démarrera au premier titre proposé."}
                </p>
                <button onClick={start} disabled={!ready}
                  className="bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white text-xl font-bold px-8 py-4 rounded-full">
                  {ready ? (now ? "▶ Reprendre la musique" : "▶ Lancer la musique") : "Chargement du lecteur…"}
                </button>
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
                  <p className="text-xs font-bold text-fuchsia-400 uppercase tracking-wider">▶ En ce moment · proposé par {now.author}</p>
                  <p className="text-xl font-bold truncate">{now.title}</p>
                  <p className="text-sm text-white/50">{now.channel}</p>
                </>
              ) : <p className="text-white/50">Aucun titre en cours.</p>}
            </div>
            {started && (
              <div className="flex items-center gap-2">
                <button onClick={togglePlay} disabled={!now} className="bg-white/10 hover:bg-white/20 disabled:opacity-30 w-11 h-11 rounded-full text-lg" aria-label={playing ? "Pause" : "Lecture"}>
                  {playing ? "⏸" : "▶"}
                </button>
                <button onClick={() => advance(true)} disabled={!now} className="bg-white/10 hover:bg-white/20 disabled:opacity-30 w-11 h-11 rounded-full text-lg" aria-label="Titre suivant">⏭</button>
                <input type="range" min={0} max={100} value={volume} onChange={(e) => changeVolume(Number(e.target.value))}
                  className="w-28 accent-fuchsia-500" aria-label="Volume" />
              </div>
            )}
          </div>
        </main>

        <aside className="space-y-5 min-w-0">
          <div className="bg-white/5 rounded-2xl p-4 flex items-center gap-4">
            {origin && (
              <button onClick={() => setBigQr(true)} className="bg-white p-1.5 rounded-lg shrink-0" aria-label="Agrandir le QR code">
                <QRCodeSVG value={joinUrl} size={104} fgColor="#0f172a" />
              </button>
            )}
            <div className="min-w-0">
              <p className="text-sm text-white/60">Proposez vos titres :</p>
              <p className="font-bold break-all">{joinUrl.replace(/^https?:\/\//, "")}</p>
              <p className="text-sm text-white/60 mt-1">code <span className="font-mono font-bold text-white text-lg">{formatCode(code)}</span></p>
            </div>
          </div>

          <div className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Ajouts des invités</span>
              <button onClick={() => act(open ? "close" : "open")}
                className={`font-bold px-3 py-1.5 rounded-full ${open ? "bg-white/10 hover:bg-white/20" : "bg-green-600 hover:bg-green-700"}`}>
                {open ? "Bloquer" : "Autoriser"}
              </button>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-white/70">Titres en attente par invité</span>
              <select value={session.maxPerParticipant} onChange={(e) => act("max", { max: Number(e.target.value) })}
                className="bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold">
                {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
              </select>
            </label>
            <div className="space-y-1.5">
              <span className="text-white/70">🔎 Versions proposées</span>
              <div className="flex bg-white/10 rounded-full p-0.5">
                {SEARCH_MODES.map((m) => (
                  <button key={m.id} onClick={() => m.id !== session.searchMode && act("searchMode", { mode: m.id })}
                    className={`flex-1 px-2 py-1 rounded-full font-bold ${m.id === session.searchMode ? "bg-fuchsia-600" : "text-white/60 hover:text-white"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-white/70">🎚️ Fondu enchaîné</span>
              <select value={session.fade} onChange={(e) => act("options", { fade: Number(e.target.value) })}
                className="bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold">
                {FADE_CHOICES.map((n) => <option key={n} value={n}>{n ? `${n} s` : "Non"}</option>)}
              </select>
            </label>
            <Toggle label="📺 File à suivre sur l'écran" on={session.screenQueue} onClick={() => act("options", { screenQueue: !session.screenQueue })} />
            <Toggle label="📱 Invités : voir toute la file" on={session.guestQueue} onClick={() => act("options", { guestQueue: !session.guestQueue })}
              hint={session.guestQueue ? null : "Ils ne voient que leurs titres et le nombre de titres avant eux."} />
            <Link href={`/jukebox/${code}/ecran`} target="_blank" className="block text-center font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">
              📺 Ouvrir l'écran d'affichage
            </Link>
            <Link href={`/jukebox/${code}`} target="_blank" className="block text-center font-bold bg-fuchsia-600 hover:bg-fuchsia-700 rounded-full py-2">
              + Ajouter un titre
            </Link>
          </div>

          <div className="bg-white/5 rounded-2xl p-4">
            <h2 className="font-bold mb-3">À suivre <span className="text-white/40 font-normal">({queue.length})</span></h2>
            {queue.length === 0 ? (
              <p className="text-sm text-white/50">La file est vide.</p>
            ) : (
              <ol className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {queue.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-2 bg-white/5 rounded-xl p-2">
                    {t.thumb && <img src={t.thumb} alt="" className="w-14 h-8 object-cover rounded shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{t.title}</p>
                      <p className="text-xs text-white/50 truncate">{t.author} · {formatDuration(t.duration)}</p>
                    </div>
                    <div className="flex shrink-0 text-white/50">
                      <IconBtn label="En tête de file" disabled={i === 0} onClick={() => act("move", { id: t.id, dir: "top" })}>⤒</IconBtn>
                      <IconBtn label="Monter" disabled={i === 0} onClick={() => act("move", { id: t.id, dir: "up" })}>↑</IconBtn>
                      <IconBtn label="Descendre" disabled={i === queue.length - 1} onClick={() => act("move", { id: t.id, dir: "down" })}>↓</IconBtn>
                      <IconBtn label="Retirer" danger onClick={() => confirm(`Retirer « ${t.title} » ?`) && act("remove", { id: t.id })}>✕</IconBtn>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/50">
            <button onClick={copyRegieLink} className="hover:text-white">{copied ? "✓ Lien copié" : "Copier le lien régie (autre appareil)"}</button>
            <button onClick={() => confirm("Vider la file et le titre en cours ?") && act("reset")} className="hover:text-white">Vider la file</button>
            <button onClick={async () => {
              if (!confirm("Supprimer définitivement cette soirée ?")) return;
              if (await act("delete")) { forgetParty(code); router.push("/jukebox"); }
            }} className="hover:text-red-400">Supprimer la soirée</button>
          </div>
        </aside>
      </div>

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

function Toggle({ label, on, onClick, hint }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-white/70">{label}</span>
        <button onClick={onClick} role="switch" aria-checked={on}
          className={`font-bold px-3 py-1.5 rounded-full shrink-0 ${on ? "bg-fuchsia-600 hover:bg-fuchsia-700" : "bg-white/10 hover:bg-white/20"}`}>
          {on ? "Oui" : "Non"}
        </button>
      </div>
      {hint && <p className="text-xs text-white/40 mt-1">{hint}</p>}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`w-7 h-7 rounded-lg disabled:opacity-20 ${danger ? "hover:text-red-400" : "hover:text-white"} hover:bg-white/10`}>
      {children}
    </button>
  );
}

function Center({ children }) {
  return <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center text-center px-6">{children}</div>;
}
