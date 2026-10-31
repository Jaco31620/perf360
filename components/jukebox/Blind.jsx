"use client";
/*
 * Jukebox — blind test : panneau de la régie (et de la télécommande) et
 * classement. Réglages : mode (réponses sur téléphone / animé par la régie),
 * filtres de la pioche dans la mémoire (langue, décennies, vidéos validées),
 * délai avant de dévoiler la réponse,
 * passage au titre suivant après la réponse. Pendant un titre : dévoiler,
 * réponses des invités (accepter l'artiste ou le titre refusé à tort), scores.
 */
import { useState } from "react";
import { Check, X } from "lucide-react";
import { BLIND_MODES, BLIND_REVEAL_CHOICES, BLIND_AFTER_CHOICES, BLIND_LANGS, DECADES, decadeLabel } from "@/lib/jukeboxBlind";

/* `controls` : boutons lecture / pause et suivant (régie ou télécommande). */
export function BlindPanel({ settings, blind, now, act, controls }) {
  return settings.on
    ? <BlindLive settings={settings} blind={blind} now={now} act={act} controls={controls} />
    : <BlindSetup settings={settings} blind={blind} act={act} />;
}

/* Nouvelle partie : tous les titres redeviennent piochables, scores remis à
 * zéro si on le confirme. */
function newGame(act) {
  if (!confirm("Nouvelle partie : tous les titres de la pioche redeviennent disponibles.\nContinuer ?")) return;
  act("blindNewGame", { scores: confirm("Remettre aussi les scores à zéro ?") });
}
const playedCount = (settings, facets) => Array.isArray(facets)
  ? sumWhere(facets, { lang: settings.lang, decades: settings.decades || [], validated: !!settings.validated }, true) : 0;

/* Résumé de la pioche : « 42 titres · 🇫🇷 · 80's, 90's · validées ». */
function pickSummary(settings, facets) {
  const f = { lang: settings.lang, decades: settings.decades || [], validated: !!settings.validated };
  const parts = [];
  if (f.lang !== "all") parts.push(BLIND_LANGS.find((l) => l.id === f.lang)?.label);
  parts.push(f.decades.length ? f.decades.map(decadeLabel).join(", ") : "toutes décennies");
  if (f.validated) parts.push("validées");
  return { available: Array.isArray(facets) ? sumWhere(facets, f) : null, text: parts.join(" · ") };
}

/* Repli (pioche, délais) : un résumé, détails au clic. */
function Fold({ title, summary, children, open: initial = false }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="bg-white/5 rounded-2xl">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-sm">{title}</span>
          {summary && <span className="block text-xs text-white/50 truncate">{summary}</span>}
        </span>
        <span className="text-white/40 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3 text-sm">{children}</div>}
    </div>
  );
}

function Timing({ settings, act }) {
  const select = "bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold";
  return (
    <>
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
      <p className="text-xs text-white/40">Les délais comptent le temps de lecture : ils s'arrêtent pendant une pause.</p>
    </>
  );
}

const timingText = (s) => `Réponse ${BLIND_REVEAL_CHOICES.find((c) => c.v === s.reveal)?.label.toLowerCase()} · suivant ${BLIND_AFTER_CHOICES.find((c) => c.v === s.after)?.label.toLowerCase()}`;

/* Avant la partie : mode de jeu, pioche, délais, lancement. */
function BlindSetup({ settings, blind, act }) {
  const pick = pickSummary(settings, blind?.facets);
  return (
    <div className="space-y-3 text-sm">
      <div className="bg-white/5 rounded-2xl p-4 space-y-3">
        <h2 className="font-bold text-base">🕵️ Préparer le blind test</h2>
        <div className="grid grid-cols-2 gap-2">
          {BLIND_MODES.map((m) => (
            <button key={m.id} onClick={() => m.id !== settings.mode && act("blind", { mode: m.id })}
              className={`text-left rounded-2xl px-3 py-2 ring-2 ${m.id === settings.mode ? "bg-fuchsia-600/30 ring-fuchsia-400" : "bg-white/5 ring-transparent"}`}>
              <span className="block font-bold text-xs">{m.id === "phone" ? "📱 " : "🎤 "}{m.label}</span>
              <span className="block text-[11px] text-white/50 leading-snug mt-0.5">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <Fold title={`🎲 Pioche${pick.available != null ? ` : ${pick.available} titre${pick.available > 1 ? "s" : ""}` : ""}`} summary={pick.text}>
        <BlindFilters settings={settings} facets={blind?.facets} onChange={(patch) => act("blind", patch, true)} />
      </Fold>

      <Fold title="⏱️ Délais" summary={timingText(settings)}>
        <Timing settings={settings} act={act} />
      </Fold>

      {playedCount(settings, blind?.facets) > 0 && (
        <button onClick={() => newGame(act)} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-2xl py-3">
          🔄 Nouvelle partie ({playedCount(settings, blind?.facets)} titre{playedCount(settings, blind?.facets) > 1 ? "s" : ""} déjà passé{playedCount(settings, blind?.facets) > 1 ? "s" : ""} redeviennent piochables)
        </button>
      )}
      <button onClick={() => act("blind", { on: true })} disabled={pick.available === 0}
        className="w-full text-lg font-bold bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-2xl py-4">
        ▶ Lancer le blind test
      </button>
      <p className="text-xs text-white/40 text-center">
        Les titres suivants sont piochés dans la mémoire et masqués ; les ajouts des invités sont suspendus pendant la partie.
      </p>
    </div>
  );
}

/* Pendant la partie : titre en cours, dévoilement, réponses, classement. */
function BlindLive({ settings, blind, now, act, controls }) {
  const phone = settings.mode === "phone";
  const pick = pickSummary(settings, blind?.facets);
  const hold = !!blind?.hold;
  return (
    <div className="space-y-3 text-sm">
      <div className="bg-white/5 rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-green-400">● Blind test en cours · {phone ? "📱 réponses sur téléphone" : "🎤 animé"}</p>
        {!now ? (
          <p className="text-white/60">Le prochain titre arrive…</p>
        ) : (
          <>
            {/* la réponse attendue, pour juger (jamais montrée au public avant le dévoilement) */}
            <div className={`rounded-xl px-3 py-2 ${blind?.revealed ? "bg-green-500/10" : "bg-amber-500/10"}`}>
              <p className={`text-[11px] font-bold uppercase tracking-wider ${blind?.revealed ? "text-green-400" : "text-amber-300"}`}>
                {blind?.revealed ? "✓ Réponse dévoilée" : `🤫 Masqué au public${blind?.revealIn != null ? ` · réponse dans ${blind.revealIn} s` : ""}`}
              </p>
              <p className="text-lg font-bold leading-snug">{now.title}</p>
              <p className="text-white/70">{now.channel}</p>
            </div>
            {controls && <div className="flex items-center justify-center gap-5">{controls}</div>}
            {!blind?.revealed ? (
              <button onClick={() => act("blindReveal")} className="w-full text-lg font-bold bg-fuchsia-600 hover:bg-fuchsia-700 rounded-2xl py-3">
                👀 Dévoiler la réponse
              </button>
            ) : settings.after > 0 && (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-xs text-white/50">
                  {hold ? "♾️ Titre prolongé jusqu'au bout (⏭ pour passer)." : blind.revealedFor != null ? `Titre suivant dans ${Math.max(0, Math.ceil(settings.after - blind.revealedFor))} s` : ""}
                </p>
                {!hold && (
                  <button onClick={() => act("blind", { holdId: now.id })}
                    className="shrink-0 text-xs font-bold rounded-full px-3 py-2 bg-fuchsia-600/80 hover:bg-fuchsia-600">
                    ♾️ Laisser jouer ce titre
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {phone && now && (
        <div className="bg-white/5 rounded-2xl p-4 space-y-2">
          <p className="font-bold">Réponses {blind?.answers?.length ? <span className="text-white/40 font-normal">({blind.answers.length})</span> : null}</p>
          {blind?.answers?.length ? (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {blind.answers.map((a) => (
                <li key={a.participantId} className="bg-white/5 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 font-semibold truncate">{a.name} <span className="text-white/40 font-normal">· {a.points} pts</span></p>
                    {[["artist", "Artiste"], ["title", "Titre"]].map(([part, label]) => (
                      <Mark key={part} ok={a[part]} label={label}
                        onAccept={() => act("blindAccept", { participantId: a.participantId, name: a.name, part })} />
                    ))}
                  </div>
                  <ol className="mt-1 space-y-0.5">
                    {(a.tries || []).map((t, k) => (
                      <li key={k} className="flex items-baseline gap-2 text-xs">
                        <span className="text-white/30 tabular-nums w-4 text-right shrink-0">{k + 1}</span>
                        <span className={`flex-1 min-w-0 break-words ${t.artist || t.title ? "text-green-300" : "text-white/60"}`}>« {t.a} »</span>
                        {(t.artist || t.title) && <span className="text-[10px] text-green-400 shrink-0">✓ {[t.artist && "artiste", t.title && "titre"].filter(Boolean).join(" + ")}</span>}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-white/40">Aucune réponse pour l'instant. Une réponse refusée à tort ? Touchez Artiste ou Titre pour l'accepter.</p>}
        </div>
      )}

      {phone && blind?.top?.length > 0 && (
        <div className="bg-white/5 rounded-2xl p-4">
          <Leaderboard top={blind.top} />
          <button onClick={() => confirm("Remettre tous les scores à zéro ?") && act("blindReset")}
            className="mt-2 text-xs text-white/40 hover:text-red-400">Remettre les scores à zéro</button>
        </div>
      )}

      <Fold title="🎲 Pioche et ⏱️ délais" summary={`${pick.available ?? "…"} titres restants · ${pick.text}`}>
        <BlindFilters settings={settings} facets={blind?.facets} onChange={(patch) => act("blind", patch, true)} />
        <Timing settings={settings} act={act} />
      </Fold>

      <button onClick={() => newGame(act)} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-2xl py-3">🔄 Nouvelle partie</button>
      <button onClick={() => confirm("Arrêter le blind test et revenir au jukebox ?") && act("blind", { on: false })}
        className="w-full font-bold bg-white/10 hover:bg-red-500/80 rounded-2xl py-3">
        ⏹ Arrêter le blind test
      </button>
    </div>
  );
}

/* Filtres de la pioche (langue, décennies, vidéos validées) avec le nombre
 * de titres correspondant à chaque choix. Les nombres sont calculés ici à
 * partir des comptes du serveur (`facets`) : ils changent dès le clic. */
const sumWhere = (facets, f, played = false) => (facets || []).reduce((n, [decade, fr, validated, used, count]) =>
  ((f.lang === "all" || (f.lang === "fr" ? fr === true : fr === false))
    && (!f.decades.length || f.decades.includes(decade))
    && (!f.validated || validated)
    && used === played ? n + count : n), 0);

function BlindFilters({ settings, facets, onChange }) {
  const f = { lang: settings.lang, decades: settings.decades || [], validated: !!settings.validated };
  const set = onChange; // affiché tout de suite (useAdminActions), enregistré dans l'ordre des clics
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
    <div className="space-y-3">
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
