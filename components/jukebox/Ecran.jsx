"use client";
/*
 * Jukebox — écran d'affichage (TV, vidéoprojecteur), sans aucun réglage :
 * titre en cours, QR code pour proposer des titres et, si la régie l'a
 * choisi, la file à suivre. Aucun son : la musique est jouée par la régie.
 * Toujours vu « comme le public » (?view=ecran, sans jeton régie).
 */
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCode } from "./storage";

const MAX_SHOWN = 6;

export default function Ecran({ code }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jukebox/${code}?view=ecran`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (res.ok) setData(await res.json());
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    setOrigin(window.location.origin);
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

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
          {now ? (
            <>
              <img src={cover} alt="" className="w-full max-w-[52vw] max-h-[52vh] aspect-video object-cover rounded-[1.5vw] shadow-2xl" />
              <p className="mt-[3vh] text-[1.3vw] font-bold uppercase tracking-wider text-fuchsia-300">▶ En ce moment</p>
              <h1 className="text-[3.6vw] font-black leading-tight line-clamp-2">{now.title}</h1>
              <p className="mt-[1vh] text-[1.6vw] text-white/70">proposé par <span className="font-bold text-white">{now.author}</span></p>
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
                        <p className="text-[0.95vw] text-white/60 truncate">{t.author}</p>
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

      <button onClick={toggleFullscreen} className="absolute bottom-3 right-3 text-sm text-white/0 hover:text-white/80 bg-black/0 hover:bg-black/40 px-3 py-1.5 rounded-full transition-colors">
        ⛶ Plein écran
      </button>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen bg-gray-950 text-white/80 flex items-center justify-center text-center px-6">{children}</div>;
}
