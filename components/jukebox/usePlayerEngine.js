"use client";
/*
 * Jukebox — moteur de lecture, partagé par la régie (PC branché à la sono)
 * et l'écran d'affichage en mode son (télé qui joue la musique). Joue la file
 * avec le lecteur YouTube intégré et enchaîne tout seul : le titre suivant
 * est préchargé dans un 2e lecteur, puis fondu enchaîné (durée réglable) ou
 * passage direct à la fin du titre ; s'il ne peut pas être lu, on demande le
 * suivant au serveur. Suit les ordres de la télécommande, envoie la position
 * de lecture (écran, télécommande, délais du blind test).
 * Les navigateurs bloquent le son sans geste de l'utilisateur : la lecture
 * démarre au clic sur « Lancer la musique » (start()).
 * `data` : état de la soirée vu par la régie (titre en cours et file complets) ;
 * `act` : actions régie (useAdminActions) ; `enabled` : conteneurs des
 * lecteurs (playerEls) affichés.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadYouTubeApi, createPlayer } from "./youtube";
import { authHeaders } from "./storage";

export function usePlayerEngine({ code, data, act, enabled }) {
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [activeIdx, setActiveIdx] = useState(0); // lecteur visible
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

  const advance = useCallback(async (skip, from = loaded.current) => {
    if (advancing.current) return;
    advancing.current = true;
    try { await act("next", { from, skip }, true); } finally { advancing.current = false; }
  }, [act]);

  // Position de lecture transmise à l'écran d'affichage (qui suit en muet) :
  // à chaque lecture / pause et toutes les 5 s. Sans titre en cours : signe de
  // vie (id vide), pour que la télécommande sache qu'un lecteur est prêt.
  const report = useCallback(() => {
    const p = players.current[active.current];
    if (!p?.getCurrentTime) return;
    const id = loaded.current || "";
    fetch(`/api/jukebox/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(code) },
      body: JSON.stringify({ action: "playback", id, pos: id ? p.getCurrentTime() : 0, playing: !!id && p.getPlayerState() === 1, volume: master.current }),
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
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!started || !b?.on || !now || !b.revealed || !b.after || b.hold || blindNext.current === now.id) return; // hold : titre prolongé
    if (b.revealedFor >= b.after) { blindNext.current = now.id; advance(false, now.id); }
  }, [data, started, advance]);

  return { playerEls, activeIdx, ready, started, start, playing, togglePlay, volume, changeVolume, advance, loadedId: () => loaded.current,
    playerState: () => { try { return cur()?.getPlayerState?.(); } catch (e) { return undefined; } } };
}
