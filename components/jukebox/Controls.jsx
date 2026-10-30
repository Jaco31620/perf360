"use client";
/*
 * Jukebox — commandes partagées par la régie et la télécommande : réglages
 * de la soirée, gestion de la file et boutons de lecture (lecture/pause,
 * titre suivant, volume). `act(action, extra)` envoie une action à
 * /api/jukebox/<code>/admin.
 */
import { Play, Pause, SkipForward, ChevronsUp, ChevronUp, ChevronDown, X, Volume1, Volume2, VolumeX } from "lucide-react";
import { MAX_CHOICES, SEARCH_MODES, FADE_CHOICES, AUTHOR_REVEAL_CHOICES, maxLabel, formatDuration } from "@/lib/jukebox";

export function Settings({ session, act }) {
  const open = session.status === "open";
  return (
    <>
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
      <Toggle label="💌 Dédicaces" on={session.dedications} onClick={() => act("options", { dedications: !session.dedications })}
        hint={session.dedications ? "Les invités peuvent ajouter un petit mot à leur titre." : null} />
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">👤 Nom de l'invité</span>
        <select value={session.authorReveal} onChange={(e) => act("options", { authorReveal: Number(e.target.value) })}
          className="bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold max-w-[55%]">
          {AUTHOR_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>
      <Toggle label="⚖️ File équitable" on={session.fairQueue} onClick={() => act("options", { fairQueue: !session.fairQueue })}
        hint={session.fairQueue ? "Les nouveaux titres alternent entre les invités." : "Les titres passent dans l'ordre d'arrivée."} />
      <Toggle label="📺 File à suivre sur l'écran" on={session.screenQueue} onClick={() => act("options", { screenQueue: !session.screenQueue })} />
      <Toggle label="📱 Invités : voir toute la file" on={session.guestQueue} onClick={() => act("options", { guestQueue: !session.guestQueue })}
        hint={session.guestQueue ? null : "Ils ne voient que leurs titres et le nombre de titres avant eux."} />
    </>
  );
}

export function QueueList({ queue, act, playNow }) {
  return (
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
                {t.dedication && (
                  <p className="text-xs text-fuchsia-300 italic flex items-start gap-1">
                    <span className="min-w-0 break-words">💌 « {t.dedication} »</span>
                    <button onClick={() => confirm("Effacer cette dédicace ?") && act("clearDedication", { id: t.id })}
                      className="not-italic text-white/40 hover:text-red-400 shrink-0" aria-label="Effacer la dédicace">✕</button>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 text-white/50">
                <IconBtn label="Jouer maintenant" onClick={() => playNow(t)}><Play size={15} fill="currentColor" /></IconBtn>
                <IconBtn label="En tête de file" disabled={i === 0} onClick={() => act("move", { id: t.id, dir: "top" })}><ChevronsUp size={17} /></IconBtn>
                <IconBtn label="Monter" disabled={i === 0} onClick={() => act("move", { id: t.id, dir: "up" })}><ChevronUp size={17} /></IconBtn>
                <IconBtn label="Descendre" disabled={i === queue.length - 1} onClick={() => act("move", { id: t.id, dir: "down" })}><ChevronDown size={17} /></IconBtn>
                <IconBtn label="Retirer" danger onClick={() => confirm(`Retirer « ${t.title} » ?`) && act("remove", { id: t.id })}><X size={16} /></IconBtn>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Toggle({ label, on, onClick, hint }) {
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

export function IconBtn({ label, onClick, disabled, danger, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`inline-flex items-center justify-center w-9 h-9 lg:w-7 lg:h-7 rounded-lg disabled:opacity-20 ${danger ? "hover:text-red-400" : "hover:text-white"} hover:bg-white/10`}>
      {children}
    </button>
  );
}


/* ---------- Boutons de lecture ---------- */

/* Lecture / pause : rond en dégradé, icône pleine. size : "md" | "lg". */
export function PlayPauseButton({ playing, onClick, disabled, size = "md" }) {
  const big = size === "lg";
  return (
    <button onClick={onClick} disabled={disabled} aria-label={playing ? "Pause" : "Lecture"}
      className={`inline-flex items-center justify-center rounded-full text-white bg-gradient-to-br from-fuchsia-500 to-indigo-600
        shadow-lg shadow-fuchsia-600/40 ring-1 ring-white/20 transition-transform hover:scale-105 active:scale-95
        disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 ${big ? "w-20 h-20" : "w-14 h-14"}`}>
      {playing
        ? <Pause size={big ? 34 : 24} fill="currentColor" strokeWidth={0} />
        : <Play size={big ? 34 : 24} fill="currentColor" strokeWidth={0} className={big ? "ml-1.5" : "ml-1"} />}
    </button>
  );
}

/* Titre suivant : rond translucide. */
export function SkipButton({ onClick, disabled, size = "md" }) {
  const big = size === "lg";
  return (
    <button onClick={onClick} disabled={disabled} aria-label="Titre suivant" title="Titre suivant"
      className={`inline-flex items-center justify-center rounded-full text-white bg-white/10 ring-1 ring-white/15 backdrop-blur
        transition hover:bg-white/20 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 ${big ? "w-14 h-14" : "w-11 h-11"}`}>
      <SkipForward size={big ? 24 : 19} fill="currentColor" strokeWidth={1.5} />
    </button>
  );
}

/* Volume : icône selon le niveau + curseur rempli en dégradé. */
export function VolumeSlider({ value, onChange, className = "" }) {
  const Icon = value === 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <label className={`flex items-center gap-2.5 text-white/70 ${className}`}>
      <button type="button" onClick={() => onChange(value === 0 ? 70 : 0)} aria-label={value === 0 ? "Remettre le son" : "Couper le son"}
        className="shrink-0 hover:text-white"><Icon size={20} /></button>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Volume"
        style={{ background: `linear-gradient(to right, #d946ef 0%, #6366f1 ${value}%, rgba(255,255,255,.15) ${value}%)` }}
        className="flex-1 min-w-0 h-1.5 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0" />
    </label>
  );
}
