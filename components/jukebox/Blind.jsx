"use client";
/*
 * Jukebox — blind test : panneau de la régie (et de la télécommande) et
 * classement. Réglages : mode (réponses sur téléphone / animé par la régie),
 * pioche automatique dans la mémoire, délai avant de dévoiler la réponse,
 * passage au titre suivant après la réponse. Pendant un titre : dévoiler,
 * réponses des invités (accepter une réponse refusée à tort), scores.
 */
import { Check, X } from "lucide-react";
import { BLIND_MODES, BLIND_REVEAL_CHOICES, BLIND_AFTER_CHOICES } from "@/lib/jukeboxBlind";
import { Toggle } from "./Controls";

export function BlindPanel({ settings, blind, now, act }) {
  const on = settings.on;
  const select = "bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold";
  return (
    <div className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-base">🕵️ Blind test</h2>
        <button onClick={() => act("blind", { on: !on })}
          className={`font-bold px-3 py-1.5 rounded-full ${on ? "bg-red-500/80 hover:bg-red-500" : "bg-green-600 hover:bg-green-700"}`}>
          {on ? "Arrêter" : "Lancer"}
        </button>
      </div>
      <div className="flex bg-white/10 rounded-full p-0.5">
        {BLIND_MODES.map((m) => (
          <button key={m.id} onClick={() => m.id !== settings.mode && act("blind", { mode: m.id })}
            className={`flex-1 px-2 py-1 rounded-full font-bold text-xs ${m.id === settings.mode ? "bg-fuchsia-600" : "text-white/60 hover:text-white"}`}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-white/40 -mt-1">{BLIND_MODES.find((m) => m.id === settings.mode)?.hint}</p>
      <Toggle label="🎲 Titres piochés automatiquement" on={settings.auto} onClick={() => act("blind", { auto: !settings.auto })}
        hint={settings.auto
          ? `Parmi les titres « blind test » de la mémoire${blind?.pool != null ? ` (${blind.pool} disponibles)` : ""}. Vous pouvez aussi ajouter les vôtres.`
          : "Vous préparez la file vous-même (+ Ajouter un titre)."} />
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">Dévoiler la réponse</span>
        <select value={settings.reveal} onChange={(e) => act("blind", { reveal: Number(e.target.value) })} className={select}>
          {BLIND_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">Titre suivant</span>
        <select value={settings.after} onChange={(e) => act("blind", { after: Number(e.target.value) })} className={select}>
          {BLIND_AFTER_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>

      {on && blind && now && (
        <div className="pt-3 border-t border-white/10 space-y-2">
          {blind.revealed ? (
            <p className="text-green-400 font-bold">✓ Réponse dévoilée</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-amber-300 font-bold">
                🤫 Titre masqué{blind.revealIn != null ? ` · réponse dans ${blind.revealIn} s` : ""}
              </span>
              <button onClick={() => act("blindReveal")} className="font-bold bg-fuchsia-600 hover:bg-fuchsia-700 px-3 py-1.5 rounded-full">Dévoiler</button>
            </div>
          )}
          {settings.mode === "phone" && (
            blind.answers?.length ? (
              <ul className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {blind.answers.map((a) => (
                  <li key={a.participantId} className="flex items-center gap-2 bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{a.name} <span className="text-white/40 font-normal">· {a.points} pts</span></p>
                      <p className="text-xs text-white/50 truncate">« {a.last} » ({a.attempts} essai{a.attempts > 1 ? "s" : ""})</p>
                    </div>
                    <Mark ok={a.artist} label="Artiste" />
                    <Mark ok={a.title} label="Titre" />
                    {!(a.artist && a.title) && (
                      <button onClick={() => act("blindAccept", { participantId: a.participantId, name: a.name })}
                        className="text-xs font-bold bg-green-600/80 hover:bg-green-600 px-2 py-1 rounded-full shrink-0" title="Compter artiste et titre">
                        Accepter
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-white/40">Aucune réponse pour ce titre.</p>
          )}
        </div>
      )}

      {on && settings.mode === "phone" && blind?.top?.length > 0 && (
        <div className="pt-3 border-t border-white/10">
          <Leaderboard top={blind.top} />
          <button onClick={() => confirm("Remettre tous les scores à zéro ?") && act("blindReset")}
            className="mt-2 text-xs text-white/40 hover:text-red-400">Remettre les scores à zéro</button>
        </div>
      )}
    </div>
  );
}

function Mark({ ok, label }) {
  return (
    <span title={label} className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ok ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/30"}`}>
      {ok ? <Check size={11} /> : <X size={11} />}{label}
    </span>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

/* Classement (top 5). `big` : écran d'affichage (tailles en vw). */
export function Leaderboard({ top, big, light }) {
  if (!top?.length) return null;
  return (
    <div>
      <h3 className={big ? "text-[1.5vw] font-bold mb-[1.5vh]" : `font-bold mb-2 ${light ? "text-gray-900" : ""}`}>🏆 Classement</h3>
      <ol className={big ? "space-y-[1vh]" : "space-y-1"}>
        {top.map((p, i) => (
          <li key={i} className={`flex items-center gap-2 ${big ? "text-[1.3vw]" : "text-sm"}`}>
            <span className={big ? "w-[2.5vw] text-center" : "w-6 text-center"}>{MEDALS[i] || i + 1}</span>
            <span className={`flex-1 truncate font-semibold ${light ? "text-gray-900" : ""}`}>{p.name}</span>
            <span className={`tabular-nums font-bold ${light ? "text-gray-500" : "text-white/70"}`}>{p.points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
