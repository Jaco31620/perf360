"use client";
/*
 * Jukebox — télécommande (téléphone de l'organisateur), sans lecteur : la
 * musique est jouée par la régie (PC branché à la sono) ou par la télé en
 * mode son. Onglets en bas : Lecture (avec la file), Blind (si activé), Plus
 * (réglages, télé, QR invités, historique).
 *  - pause / lecture / volume : ordres transmis à la régie (champ `command`,
 *    lu à chaque rafraîchissement de la régie, ~1,5 s) ;
 *  - titre suivant, file et réglages : mêmes actions que la régie.
 * L'état affiché (lecture, position, volume) vient de `playback`, envoyé par
 * la régie. Accès : jeton régie (QR « Télécommande » de la régie, #t=…) ou
 * super-admin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { setAdminToken, authHeaders, formatCode } from "./storage";
import { useAdminActions } from "./optimistic";
import { useWakeLock } from "./useWakeLock";
import { Settings, QueueList, GuestsSwitch, AddTrack, PlayPauseButton, SkipButton, VolumeSlider, FixVideoButton, VideoPicker } from "./Controls";
import { QRCodeSVG } from "qrcode.react";
import { formatDuration, playSpan } from "@/lib/jukebox";
import History from "./History";
import TvLink from "./TvLink";
import { JoinForm, AccessPanel, useJoinPass } from "./Access";
import { BlindPanel } from "./Blind";

export default function Telecommande({ code }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [volume, setVolume] = useState(null); // valeur du curseur pendant qu'on le bouge
  const [tab, setTab] = useState("play"); // onglet (retenu par appareil)
  useEffect(() => { try { const t = localStorage.getItem("jukebox:remoteTab"); if (t) setTab(t); } catch (e) { /* ignoré */ } }, []);
  const chooseTab = (t) => { setTab(t); window.scrollTo(0, 0); try { localStorage.setItem("jukebox:remoteTab", t); } catch (e) { /* ignoré */ } };
  const [guestQr, setGuestQr] = useState(false);
  const [pcHelp, setPcHelp] = useState(false);
  const [fixing, setFixing] = useState(null); // titre dont on corrige la vidéo
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tvOpen, setTvOpen] = useState(false); // « Connecter une télé »
  const [pending, setPending] = useState(null); // ordre envoyé, pas encore appliqué : "play" | "pause"
  const [, tick] = useState(0);
  const volumeTimer = useRef(null);
  const mismatchSince = useRef(null); // depuis quand le lecteur joue un autre titre que celui en cours

  useEffect(() => {
    const m = window.location.hash.match(/t=([a-f0-9]+)/);
    if (m) {
      setAdminToken(code, m[1]);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [code]);

  const { act, fresh, refreshRef } = useAdminActions(code, setData);
  useWakeLock(); // pas de mise en veille pendant la soirée
  const refresh = useCallback(async () => {
    const started = Date.now();
    try {
      const res = await fetch(`/api/jukebox/${code}`, { cache: "no-store", headers: authHeaders(code) });
      if (res.status === 404) return setMissing(true);
      if (res.ok) {
        const d = await res.json();
        if (!fresh(started)) return; // une action a eu lieu entre-temps : réponse périmée
        d.fetchedAt = Date.now();
        setData(d);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code, fresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 2000);
    const t = setInterval(() => tick((n) => n + 1), 1000); // barre de progression
    return () => { clearInterval(id); clearInterval(t); };
  }, [refresh]);

  refreshRef.current = refresh;
  const passError = useJoinPass(code, refresh); // QR « Ajouter un téléphone » de la régie

  // l'ordre lecture/pause est considéré comme appliqué dès que la régie confirme l'état voulu
  useEffect(() => {
    const pb = data?.playback;
    if (pending && pb && data.now && pb.id === data.now.id && pb.playing === (pending === "play")) setPending(null);
  }, [data, pending]);

  if (missing) return <Center>La soirée {formatCode(code)} n'existe pas (ou plus).</Center>;
  if (!data) return <Center>Chargement…</Center>;
  if (!data.admin) {
    return <Center><JoinForm code={code} name={data.session.name} onJoined={refresh} error={passError} /></Center>;
  }

  const { session, now, queue, playback: pb } = data;
  const live = pb && now && pb.id === now.id;
  const age = pb ? data.serverTime - pb.at + (Date.now() - data.fetchedAt) : Infinity;
  // Le lecteur envoie son état toutes les 5 s. Au changement de titre, il
  // annonce encore l'ancien quelques secondes (chargement, fondu) : on ne
  // s'inquiète que s'il se tait, ou s'il reste sur un autre titre plus de 20 s.
  if (live || !now) mismatchSince.current = null;
  else if (mismatchSince.current == null) mismatchSince.current = Date.now();
  const lagging = mismatchSince.current != null && Date.now() - mismatchSince.current > 20000;
  const regieOk = !!pb && age < 15000 && !lagging;
  const playerSeen = pb && age < 60000; // un lecteur (régie ou télé) a donné signe de vie récemment
  const isPlaying = pending ? pending === "play" : !!(live && pb.playing);
  // position dans la partie jouée (rognage : début et fin d'habillage retirés)
  const span = now ? playSpan(now) : null;
  const pos = live ? Math.max(0, Math.min(span.length || Infinity, pb.pos + (pb.playing ? age / 1000 : 0) - span.start)) : 0;
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

  const tabs = [
    { id: "play", icon: "▶", label: `Lecture${queue.length ? ` · ${queue.length}` : ""}` },
    ...(session.blindSettings ? [{ id: "blind", icon: "🕵️", label: "Blind", dot: session.blindSettings.on }] : []),
    { id: "more", icon: "⚙️", label: "Plus" },
  ];
  const shown = tabs.some((t) => t.id === tab) ? tab : "play";
  const joinUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/jukebox/${code}`;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4 py-2.5">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="font-extrabold truncate leading-tight">{session.name}</h1>
            <p className="text-[11px] text-white/40">📱 Télécommande · code <span className="font-mono">{formatCode(code)}</span></p>
          </div>
          <GuestsSwitch open={session.status === "open"} act={act} />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 pb-28 space-y-4">
        {shown === "play" && (
          <section className="space-y-5">
            {now ? (
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                {now.thumb && <img src={now.thumb} alt="" className="w-[42%] shrink-0 aspect-video object-cover rounded-2xl shadow-xl" />}
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold leading-snug line-clamp-2">{now.title}</p>
                  {now.channel && <p className="text-sm text-white/70 truncate">{now.channel}</p>}
                  <p className="text-xs text-white/40 mt-0.5">proposé par {now.author}</p>
                  {now.dedication && (
                    <p className="text-sm text-fuchsia-300 italic mt-1">
                      💌 « {now.dedication} »
                      <button onClick={() => confirm("Effacer cette dédicace ?") && act("clearDedication", { id: now.id })}
                        className="not-italic ml-2 text-white/40" aria-label="Effacer la dédicace">✕</button>
                    </p>
                  )}
                  <div className="mt-1"><FixVideoButton onClick={() => setFixing(now)} /></div>
                </div>
                </div>
                <div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-fuchsia-500" style={{ width: `${span.length ? Math.min(100, (pos / span.length) * 100) : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-white/40 mt-1">
                    <span>{formatDuration(Math.floor(pos))}</span><span>{span.trimmed && <span title="Vidéo rognée : début ou fin d'habillage sauté">✂️ </span>}{formatDuration(Math.round(span.length))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-white/50 text-center py-10">Aucun titre en cours.</p>
            )}

            {!playerSeen ? (
              <div className="bg-fuchsia-500/10 border border-fuchsia-400/30 rounded-2xl p-4 space-y-3">
                <p className="font-bold">🔊 Aucun lecteur pour l'instant</p>
                <p className="text-sm text-white/60">La musique est jouée par une télé ou un ordinateur ; ce téléphone les pilote.</p>
                <button onClick={() => setTvOpen(true)} className="w-full font-bold bg-fuchsia-600 hover:bg-fuchsia-700 rounded-full py-3">📺 Connecter une télé</button>
                <button onClick={() => setPcHelp((v) => !v)} className="w-full font-bold bg-white/10 rounded-full py-2 text-sm">💻 Utiliser un ordinateur</button>
                {pcHelp && (
                  <p className="text-sm text-white/70">
                    Sur l'ordinateur branché à la sono, ouvrez <b className="text-white break-all">{joinUrl.replace(/^https?:\/\//, "")}/regie</b> puis
                    tapez le code régie (onglet ⚙️ Plus).
                  </p>
                )}
              </div>
            ) : now && !regieOk && (
              <p className="text-sm text-amber-300 bg-amber-500/10 rounded-xl px-3 py-2">
                ⚠️ Le lecteur ne répond pas : vérifiez que la régie (ordinateur) ou l'écran en mode son (télé) est toujours ouvert.
              </p>
            )}

            <div className="flex items-center gap-3">
              <PlayPauseButton playing={isPlaying} onClick={togglePlay} disabled={!now} />
              <SkipButton onClick={skip} disabled={!now} />
              <VolumeSlider value={shownVolume} onChange={changeVolume} className="flex-1 min-w-0 ml-1" />
              <span className="w-7 text-right text-xs text-white/50 tabular-nums">{shownVolume}</span>
            </div>

            <AddTrack code={code} queue={queue} now={now} onAdded={refresh} />
            <QueueList queue={queue} act={act} playNow={playNow} onFixVideo={setFixing} />
          </section>
        )}

        {shown === "blind" && session.blindSettings && <BlindPanel settings={session.blindSettings} blind={data.blind} now={now} act={act}
          controls={<><PlayPauseButton playing={isPlaying} onClick={togglePlay} disabled={!now} /><SkipButton onClick={skip} disabled={!now} /></>} />}

        {shown === "more" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setTvOpen(true)} className="font-bold bg-white/10 active:bg-white/20 rounded-2xl py-3 text-sm">📺 Connecter une télé</button>
              <button onClick={() => setGuestQr(true)} className="font-bold bg-white/10 active:bg-white/20 rounded-2xl py-3 text-sm">🔳 QR code invités</button>
              {session.features.history && (
                <button onClick={() => setHistoryOpen(true)} className="col-span-2 font-bold bg-white/10 active:bg-white/20 rounded-2xl py-3 text-sm">🕘 Historique de la soirée</button>
              )}
            </div>
            <AccessPanel code={code} name={session.name} />
            <section className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
              <Settings session={session} act={act} />
            </section>
          </>
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-gray-900/95 backdrop-blur border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto flex">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => chooseTab(t.id)}
              className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${shown === t.id ? "text-fuchsia-300" : "text-white/50"}`}>
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
              {t.dot && <span className="absolute top-2 right-[30%] w-2 h-2 rounded-full bg-green-400" />}
              {shown === t.id && <span className="absolute top-0 inset-x-6 h-0.5 rounded-full bg-fuchsia-400" />}
            </button>
          ))}
        </div>
      </nav>

      {tvOpen && <TvLink code={code} beat={data?.playback?.at ?? null} onClose={() => setTvOpen(false)} />}
      {historyOpen && <History code={code} name={session.name} onClose={() => setHistoryOpen(false)} onChanged={refresh} />}
      {fixing && <VideoPicker code={code} track={fixing} onClose={() => setFixing(null)} onDone={refresh} />}
      {guestQr && (
        <div onClick={() => setGuestQr(false)} className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-5 p-6 text-center">
          <div className="bg-white p-4 rounded-3xl"><QRCodeSVG value={joinUrl} size={260} /></div>
          <p className="text-lg font-bold">{joinUrl.replace(/^https?:\/\//, "")}</p>
          <p className="text-white/60">code <span className="font-mono font-bold text-white text-2xl">{formatCode(code)}</span></p>
        </div>
      )}
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center text-center px-6">{children}</div>;
}
