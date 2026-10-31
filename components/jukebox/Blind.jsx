"use client";
/*
 * Jukebox — blind test : panneau de la régie (et de la télécommande) et
 * classement. Réglages : mode (réponses sur téléphone / animé par la régie),
 * filtres de la pioche dans la mémoire (langue, décennies, vidéos validées),
 * délai avant de dévoiler la réponse,
 * passage au titre suivant après la réponse. Pendant un titre : dévoiler,
 * réponses des invités (accepter l'artiste ou le titre refusé à tort), scores.
 */
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { BLIND_MODES, BLIND_REVEAL_CHOICES, BLIND_AFTER_CHOICES, BLIND_LANGS, DECADES, decadeLabel } from "@/lib/jukeboxBlind";

export function BlindPanel({ settings, blind, now, act }) {
  const on = settings.on;
  const select = "bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold";
  return (
    <div className="bg-white/5 rounded-2xl p-4 space-y-4 text-sm">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-base">🕵️ Blind test {on && <span className="ml-1 text-xs font-bold text-green-400">● en cours</span>}</h2>
          <button onClick={() => act("blind", { on: !on })}
            className={`font-bold px-3 py-1.5 rounded-full text-xs ${on ? "bg-red-500/80 hover:bg-red-500" : "bg-green-600 hover:bg-green-700"}`}>
            {on ? "Revenir au jukebox" : "Passer en blind test"}
          </button>
        </div>
        <p className="text-xs text-white/40 mt-1">
          {on
            ? "Titres piochés et masqués, ajouts des invités suspendus. Pause et lecture se font comme d'habitude (les délais s'arrêtent pendant une pause)."
            : "Bascule la soirée en jeu : les titres suivants sont piochés dans la mémoire et masqués. La musique se lance et se met en pause avec le lecteur, comme d'habitude."}
        </p>
      </div>

      <BlindFilters settings={settings} facets={blind?.facets} onChange={(patch) => act("blind", patch, true)} />

      <div className="space-y-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-white/40">⏱️ Déroulé</p>
        <div className="flex bg-white/10 rounded-full p-0.5">
          {BLIND_MODES.map((m) => (
            <button key={m.id} onClick={() => m.id !== settings.mode && act("blind", { mode: m.id })}
              className={`flex-1 px-2 py-1 rounded-full font-bold text-xs ${m.id === settings.mode ? "bg-fuchsia-600" : "text-white/60 hover:text-white"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/40 -mt-1">{BLIND_MODES.find((m) => m.id === settings.mode)?.hint}</p>
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
      </div>

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
                    {[["artist", "Artiste"], ["title", "Titre"]].map(([part, label]) => (
                      <Mark key={part} ok={a[part]} label={label}
                        onAccept={() => act("blindAccept", { participantId: a.participantId, name: a.name, part })} />
                    ))}
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

/* Filtres de la pioche (langue, décennies, vidéos validées) avec le nombre
 * de titres correspondant à chaque choix. Les nombres sont calculés ici à
 * partir des comptes du serveur (`facets`) : ils changent dès le clic, le
 * réglage est enregistré en arrière-plan. */
const sumWhere = (facets, f, played = false) => (facets || []).reduce((n, [decade, fr, validated, used, count]) =>
  ((f.lang === "all" || (f.lang === "fr" ? fr === true : fr === false))
    && (!f.decades.length || f.decades.includes(decade))
    && (!f.validated || validated)
    && used === played ? n + count : n), 0);

function BlindFilters({ settings, facets, onChange }) {
  const saved = { lang: settings.lang, decades: settings.decades || [], validated: !!settings.validated };
  const [local, setLocal] = useState(saved);
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setLocal(JSON.parse(savedKey)); }, [savedKey]); // réglage enregistré (ou changé ailleurs)
  const set = (patch) => { setLocal((f) => ({ ...f, ...patch })); onChange(patch); };
  const f = local;
  const toggleDecade = (d) => set({ decades: f.decades.includes(d) ? f.decades.filter((x) => x !== d) : [...f.decades, d].sort() });

  const ready = Array.isArray(facets);
  const available = sumWhere(facets, f);
  const played = sumWhere(facets, f, true);
  const tagged = (facets || []).reduce((n, c) => n + c[4], 0);
  const noYear = f.decades.length ? sumWhere(facets, { ...f, decades: [null] }) + sumWhere(facets, { ...f, decades: [null] }, true) : 0;
  const count = (patch) => (ready ? sumWhere(facets, { ...f, ...patch }) : null);
  const badge = (n, active) => n == null ? null : (
    <span className={`ml-1 tabular-nums ${active ? "text-white/80" : "text-white/40"}`}>{n}</span>
  );

  return (
    <div className="space-y-3 bg-white/5 rounded-xl p-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-white/40">🎲 Pioche</p>
          <p className="text-xs text-white/40">{ready ? `parmi ${tagged} titre${tagged > 1 ? "s" : ""} 🕵️ de la mémoire` : "Chargement…"}</p>
        </div>
        {ready && (
          <div className="text-right">
            <p className={`text-3xl font-black tabular-nums leading-none ${available < 10 ? "text-red-400" : "text-white"}`}>{available}</p>
            <p className="text-[11px] text-white/50">disponible{available > 1 ? "s" : ""}{played ? ` · ${played} déjà passé${played > 1 ? "s" : ""}` : ""}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 bg-white/10 rounded-xl p-0.5">
        {BLIND_LANGS.map((l) => (
          <button key={l.id} onClick={() => l.id !== f.lang && set({ lang: l.id })}
            className={`px-1 py-1.5 rounded-lg font-bold text-xs ${l.id === f.lang ? "bg-fuchsia-600" : "text-white/60 hover:text-white"}`}>
            {l.label}{badge(count({ lang: l.id }), l.id === f.lang)}
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs text-white/50 mb-1">Décennies <span className="text-white/30">(une ou plusieurs)</span></p>
        <div className="grid grid-cols-3 gap-1">
          <button onClick={() => f.decades.length && set({ decades: [] })}
            className={`py-1.5 rounded-lg text-xs font-bold ${f.decades.length ? "bg-white/10 text-white/70 hover:text-white" : "bg-fuchsia-600"}`}>
            Toutes{badge(count({ decades: [] }), !f.decades.length)}
          </button>
          {DECADES.map((d) => {
            const active = f.decades.includes(d);
            const n = count({ decades: [d] });
            return (
              <button key={d} onClick={() => toggleDecade(d)}
                className={`py-1.5 rounded-lg text-xs font-bold ${active ? "bg-fuchsia-600" : n === 0 ? "bg-white/5 text-white/25" : "bg-white/10 text-white/70 hover:text-white"}`}>
                {decadeLabel(d)}{badge(n, active)}
              </button>
            );
          })}
        </div>
        {noYear > 0 && <p className="text-[11px] text-white/40 mt-1">{noYear} titre{noYear > 1 ? "s" : ""} sans année connue, écarté{noYear > 1 ? "s" : ""} par le filtre décennies.</p>}
      </div>

      <button onClick={() => set({ validated: !f.validated })} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="text-white/70">Vidéos validées seulement{badge(count({ validated: true }), f.validated)}</span>
        <span className={`font-bold px-3 py-1 rounded-full text-xs ${f.validated ? "bg-fuchsia-600" : "bg-white/10"}`}>{f.validated ? "Oui" : "Non"}</span>
      </button>

      {ready && available === 0 && (
        <p className="text-xs text-red-300">Aucun titre ne correspond : élargissez les filtres, ou marquez d'autres titres 🕵️ dans le super-admin.</p>
      )}
    </div>
  );
}

/* Élément trouvé (vert) ; sinon bouton pour l'accepter (+50 pts). */
function Mark({ ok, label, onAccept }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-green-500/20 text-green-300">
        <Check size={11} />{label}
      </span>
    );
  }
  return (
    <button onClick={onAccept} title={`Accepter : ${label.toLowerCase()} trouvé (+50 pts)`}
      className="group inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-white/10 text-white/40 hover:bg-green-600 hover:text-white">
      <X size={11} className="group-hover:hidden" /><Check size={11} className="hidden group-hover:block" />{label}
    </button>
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
