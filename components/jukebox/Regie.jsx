"use client";
/*
 * Jukebox — régie (PC branché à la sono, ou TV). Joue la file avec le lecteur
 * YouTube intégré et enchaîne tout seul : à la fin d'un titre (ou s'il ne peut
 * pas être lu), on demande le suivant au serveur. Rafraîchit la file toutes
 * les 2 s. Jeton régie en localStorage, ou #t=… dans l'URL pour ouvrir la
 * régie sur un autre appareil.
 * Les navigateurs bloquent le son sans geste de l'utilisateur : la lecture
 * démarre au clic sur « Lancer la musique ».
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { getAdminToken, setAdminToken, rememberParty, forgetParty, formatCode } from "./storage";
import { MAX_CHOICES, maxLabel, formatDuration } from "@/lib/jukebox";

export default function Regie({ code }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [bigQr, setBigQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = useRef(null);
  const player = useRef(null);
  const playerEl = useRef(null);
  const loaded = useRef(null); // id du titre chargé dans le lecteur
  const advancing = useRef(false);

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

  const advance = useCallback(async (skip) => {
    if (advancing.current) return;
    advancing.current = true;
    try { await act("next", { from: loaded.current, skip }, true); } finally { advancing.current = false; }
  }, [act]);

  // Les événements du lecteur sont branchés une fois : ils passent par une ref.
  const onEvent = useRef({});
  onEvent.current = { advance };

  // Lecteur YouTube (IFrame API)
  useEffect(() => {
    let cancelled = false;
    const create = () => {
      if (cancelled || player.current || !playerEl.current) return;
      // élément créé hors de React : le lecteur le remplace par son iframe
      const el = document.createElement("div");
      playerEl.current.appendChild(el);
      player.current = new window.YT.Player(el, {
        width: "100%", height: "100%",
        playerVars: { autoplay: 0, rel: 0, playsinline: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e) => {
            setPlaying(e.data === 1);
            if (e.data === 0) onEvent.current.advance(false); // terminé
          },
          onError: () => onEvent.current.advance(true), // lecture bloquée, vidéo retirée…
        },
      });
    };
    if (window.YT?.Player) create();
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); create(); };
      if (!document.getElementById("yt-iframe-api")) {
        const s = document.createElement("script");
        s.id = "yt-iframe-api";
        s.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(s);
      }
    }
    return () => { cancelled = true; };
  }, [data?.admin]); // le conteneur n'existe qu'une fois l'accès régie confirmé

  // Synchronise le lecteur avec le titre en cours côté serveur.
  useEffect(() => {
    if (!started || !ready || !data) return;
    const now = data.now;
    if (now && loaded.current !== now.id) {
      loaded.current = now.id;
      player.current.loadVideoById(now.videoId);
    } else if (!now) {
      if (loaded.current) { player.current.stopVideo(); loaded.current = null; }
      if (data.queue.length) advance(false);
    }
  }, [data, started, ready, advance]);

  const start = () => {
    setStarted(true);
    // dans le geste du clic : le navigateur autorise le son
    if (data?.now) {
      loaded.current = data.now.id;
      player.current.loadVideoById(data.now.videoId);
    }
  };

  const togglePlay = () => (playing ? player.current?.pauseVideo() : player.current?.playVideo());
  const changeVolume = (v) => { setVolume(v); player.current?.setVolume(v); };

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
            <div ref={playerEl} className="absolute inset-0" />
            {!started && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 text-center px-6">
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
              <div className="absolute inset-0 flex items-center justify-center bg-black text-white/60 text-center px-6 pointer-events-none">
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
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">🎤 Titres karaoké en priorité</span>
              <button onClick={() => act("karaoke", { on: !session.karaoke })} role="switch" aria-checked={session.karaoke}
                className={`font-bold px-3 py-1.5 rounded-full ${session.karaoke ? "bg-fuchsia-600 hover:bg-fuchsia-700" : "bg-white/10 hover:bg-white/20"}`}>
                {session.karaoke ? "Oui" : "Non"}
              </button>
            </div>
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
