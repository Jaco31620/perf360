"use client";
/*
 * Jukebox — régie (PC branché à la sono) : lecteur (moteur partagé avec
 * l'écran en mode son, usePlayerEngine), file, réglages, blind test, outils.
 * Rafraîchit la file toutes les 1,5 s. Jeton régie en localStorage, ou #t=…
 * dans l'URL pour ouvrir la régie sur un autre appareil.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { usePlayerEngine } from "./usePlayerEngine";
import { setAdminToken, authHeaders, rememberParty, forgetParty, formatCode } from "./storage";
import { useAdminActions } from "./optimistic";
import { useWakeLock } from "./useWakeLock";
import { Settings, QueueList, GuestsSwitch, AddTrack, PlayPauseButton, SkipButton, VolumeSlider, FixVideoButton, VideoPicker } from "./Controls";
import { Play } from "lucide-react";
import History from "./History";
import TvLink from "./TvLink";
import { JoinForm, AccessPanel, useJoinPass } from "./Access";
import { BlindPanel } from "./Blind";

export default function Regie({ code }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [bigQr, setBigQr] = useState(false);
  const [fixing, setFixing] = useState(null); // titre dont on corrige la vidéo
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tvOpen, setTvOpen] = useState(false); // « Connecter une télé »
  const [peek, setPeek] = useState(null); // blind test : titre affiché quand même en régie
  const [tab, setTab] = useState("queue"); // onglet de la colonne de droite (retenu par appareil)
  useEffect(() => { try { const t = localStorage.getItem("jukebox:regieTab"); if (t) setTab(t); } catch (e) { /* ignoré */ } }, []);
  const chooseTab = (t) => { setTab(t); try { localStorage.setItem("jukebox:regieTab", t); } catch (e) { /* ignoré */ } };
  useEffect(() => {
    const m = window.location.hash.match(/t=([a-f0-9]+)/);
    if (m) {
      setAdminToken(code, m[1]);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setOrigin(window.location.origin);
  }, [code]);

  const { act, fresh, refreshRef } = useAdminActions(code, setData);
  useWakeLock(); // pas de mise en veille pendant la soirée
  const refresh = useCallback(async () => {
    const started = Date.now();
    try {
      const res = await fetch(`/api/jukebox/${code}`, {
        cache: "no-store",
        headers: authHeaders(code),
      });
      if (res.status === 404) return setMissing(true);
      if (res.ok) {
        const d = await res.json();
        if (!fresh(started)) return; // une action a eu lieu entre-temps : réponse périmée
        d.fetchedAt = Date.now();
        setData(d);
        if (d.admin) rememberParty(code, d.session.name);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code, fresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  refreshRef.current = refresh;
  const passError = useJoinPass(code, refresh); // QR « Ajouter un appareil »

  const { playerEls, activeIdx, ready, started, start, playing, togglePlay, volume, changeVolume, advance } =
    usePlayerEngine({ code, data, act, enabled: !!data?.admin });

  const playNow = (t) => {
    if (data.now && !confirm(`Lancer « ${t.title} » maintenant ?\nLe titre en cours sera interrompu.`)) return;
    act("playnow", { id: t.id });
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
    return <Center><JoinForm code={code} name={data.session.name} onJoined={refresh} error={passError} /></Center>;
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
        <GuestsSwitch open={open} act={act} />
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
                  {ready ? <span className="inline-flex items-center gap-2"><Play size={22} fill="currentColor" strokeWidth={0} />{now ? "Reprendre la musique" : "Lancer la musique"}</span> : "Chargement du lecteur…"}
                </button>
              </div>
            )}
            {started && masked && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-gray-950 text-center px-6">
                <p className="text-5xl">🕵️</p>
                <p className="text-white/70">Blind test : vidéo masquée jusqu'à la réponse.</p>
                <button onClick={() => setPeek(now.id)} className="text-sm text-white/50 underline">Afficher quand même (régie)</button>
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
              <AddTrack code={code} queue={queue} now={now} onAdded={refresh} />
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

          {shown === "blind" && session.blindSettings && <BlindPanel settings={session.blindSettings} blind={data.blind} now={now} act={act}
            controls={started ? <><PlayPauseButton playing={playing} onClick={togglePlay} disabled={!now} /><SkipButton onClick={() => advance(true)} disabled={!now} /></> : null} />}

          {shown === "tools" && (
            <div className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
              <Link href={`/jukebox/${code}/ecran`} target="_blank" className="block text-center font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">
                📺 Ouvrir l'écran d'affichage
              </Link>
              <button onClick={() => setTvOpen(true)} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">
                📺 Connecter une télé (perf360.fr/tv)
              </button>
              <AccessPanel code={code} name={session.name} />
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
      {tvOpen && <TvLink code={code} defaultSound={false} onClose={() => setTvOpen(false)} />}
      {historyOpen && <History code={code} name={session.name} onClose={() => setHistoryOpen(false)} onChanged={refresh} />}

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
