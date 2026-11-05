"use client";
import { useState } from "react";

/* Titre d'origine de la vidéo YouTube (et sa chaîne), en petit sous le libellé. */
export function VideoTitle({ song, className = "" }) {
  if (!song.videoTitle) return null;
  return (
    <p className={`text-[11px] text-gray-400 ${className}`} title={`Vidéo YouTube : ${song.videoTitle}${song.videoChannel ? ` · ${song.videoChannel}` : ""}`}>
      ▶ {song.videoTitle}{song.videoChannel && <span className="text-gray-300"> · {song.videoChannel}</span>}
    </p>
  );
}

/* Interprète (clic : tous ses titres) – titre (clic : rattacher à un autre
 * titre Deezer) ; ✏️ corrige le texte affiché sans changer de titre. */
export function SongName({ song, onArtist, onTitle, onEdit, wrap = false, artistActive = false, className = "text-sm font-semibold",
  artistHint = "Voir tous les titres de cet interprète", titleHint = "Mauvais artiste ou titre (reprise, compilation…) ? Cliquer pour rattacher au bon titre Deezer" }) {
  if (!song.label) return <span className="text-gray-400 font-mono text-xs">{song.key}</span>;
  return (
    <div className={`flex items-baseline gap-1 min-w-0 text-gray-900 ${className}`} title={song.fixed || song.label !== `${song.artist} – ${song.title}` ? `Libellé Deezer : ${song.label}` : undefined}>
      <span className={wrap ? "" : "truncate"}>
        {song.artist && <><button onClick={() => onArtist(song.artist)} title={artistHint} className={`hover:text-fuchsia-700 hover:underline ${artistActive ? "text-fuchsia-700 underline" : ""}`}>{song.artist}</button>{" – "}</>}
        <button onClick={onTitle} title={titleHint} className="hover:text-fuchsia-700 text-left">{song.title}</button>
      </span>
      {song.fixed && <span className="shrink-0 text-[10px] font-bold text-fuchsia-600" title={`Corrigé à la main · libellé Deezer : ${song.label}`}>✏️</span>}
      <button onClick={onEdit} title="Corriger le texte (interprète, titre) sans changer de titre ni de vidéo"
        className="shrink-0 text-xs text-gray-400 hover:text-fuchsia-700 px-1">✎</button>
    </div>
  );
}

/* draftRef (facultatif) : saisie en cours, lue par la revue pour l'enregistrer
 * d'office quand on passe au titre suivant (Valider et suivant, Passer, flèches). */
export function SongTextForm({ song, onSave, onCancel, focus = "artist", draftRef }) {
  const [artist, setArtist] = useState(song.artist || "");
  const [title, setTitle] = useState(song.title || "");
  const changed = artist.trim() !== (song.artist || "") || title.trim() !== (song.title || "");
  if (draftRef) draftRef.current = changed ? { artist, title } : null;
  const submit = (e) => { e.preventDefault(); onSave(artist, title); };
  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()} className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Interprète" autoFocus={focus !== "title"}
          className="flex-1 min-w-[120px] border-2 border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-fuchsia-500 outline-none" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre" autoFocus={focus === "title"}
          className="flex-[2] min-w-[160px] border-2 border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-fuchsia-500 outline-none" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button className="font-bold text-white bg-fuchsia-600 px-3 py-1 rounded-full">Enregistrer</button>
        {changed && draftRef && <span className="font-bold text-fuchsia-700">● modifié — enregistré aussi dès que vous faites autre chose</span>}
        <button type="button" onClick={onCancel} className="font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Annuler</button>
        {song.fixed && <button type="button" onClick={() => onSave("", "")} className="text-gray-500 underline">Revenir au texte automatique</button>}
        <span className="text-gray-400">Libellé Deezer : {song.label}</span>
      </div>
    </form>
  );
}

/* Décision blind test d'une chanson : 0 non, 1 oui, 2 oui très difficile. */
export const blindLevel = (song) => (!song.blind ? 0 : song.difficulty >= 2 ? 2 : 1);

/* Étiquette blind test de la chanson, d'un seul tenant : 🕵️ (oui / non / à
 * décider) et, collé à droite quand c'est oui, 🎓 très difficile (pioché au
 * plus 1 fois sur N, si la soirée les inclut). « Oui » d'avant la décision
 * datée : joué, mais « à confirmer ». `sub` : précision sous 🕵️ (revue). */
export function BlindTag({ song, onLevel, big = false, sub = null }) {
  const lv = blindLevel(song);
  const hard = lv === 2;
  const pending = !song.blindDecided;
  // 🎓 : ambre quand très difficile (l'émoji, sombre, reste lisible), violet pâle sinon
  const hardCls = hard ? "bg-amber-300 text-amber-950 hover:bg-amber-200" : "bg-violet-100 text-violet-600 hover:text-violet-900";
  const hardTitle = hard ? "Très difficile : pioché seulement si la soirée inclut les titres très difficiles (au plus 1 sur N). Cliquer : difficulté normale"
    : "Difficulté normale. Cliquer si ce titre est trop dur pour une soirée grand public";
  const label = song.blind ? "Blind test" : pending ? (big ? "Blind test : à décider" : "Blind test ?") : "Pas au blind";
  const off = pending ? "bg-white text-gray-500 border border-dashed border-gray-300 hover:text-gray-900" : "bg-gray-100 text-gray-400 hover:text-gray-700";
  // clic : « oui » d'avant à confirmer → confirmé (niveau gardé) ; oui décidé → retiré ; sinon → oui
  const next = song.blind ? (pending ? lv : 0) : 1;
  const blindTitle = song.blind && pending ? "Confirmer : garder au blind test (cliquer encore pour le retirer)" : song.blind ? "Retirer du blind test (pour la chanson : toutes ses versions)" : "Utiliser dans le blind test (version paroles, sinon clip)";
  const wait = pending && song.blind && <span className={`font-semibold opacity-80 ${big ? "text-xs" : "text-[10px]"}`}> · à confirmer</span>;
  if (big) { // revue : 🕵️ en haut, 🎓 en bandeau dessous (tient dans la case)
    return (
      <div className={`flex flex-col min-w-0 rounded-xl overflow-hidden ${song.blind ? "bg-violet-600 text-white" : off}`}>
        <button onClick={() => onLevel(next)} title={blindTitle} className="flex-1 text-sm font-bold px-3 py-2 text-left min-w-0">
          🕵️ {label}{wait}
          {sub && <span className="block text-[10px] font-semibold opacity-80">{sub}</span>}
        </button>
        {song.blind && (
          <button onClick={() => onLevel(hard ? 1 : 2)} title={hardTitle} className={`text-xs font-bold px-3 py-1 text-left ${hardCls}`}>
            🎓 {hard ? "Très difficile" : "Difficulté normale"}
          </button>
        )}
      </div>
    );
  }
  return (
    <span className="inline-flex items-stretch">
      <button onClick={() => onLevel(next)} title={blindTitle}
        className={`text-[11px] font-bold px-2 py-0.5 whitespace-nowrap ${song.blind ? "bg-violet-600 text-white rounded-l-full" : `${off} rounded-full`}`}>
        🕵️ {label}{wait}
      </button>
      {song.blind && (
        <button onClick={() => onLevel(hard ? 1 : 2)} title={hardTitle} className={`text-[11px] font-bold px-2 py-0.5 whitespace-nowrap rounded-r-full ${hardCls}`}>
          🎓{hard ? " Très difficile" : " ?"}
        </button>
      )}
    </span>
  );
}

/* Réponses des invités au blind test (« trouvé par 2 sur 11 ») et, si les
 * réponses reçues depuis la décision le suggèrent, reclassement ou « Garder
 * ainsi » (seules les réponses suivantes compteront). */
export function BlindStat({ song, run }) {
  const st = song.blindStat;
  if (!song.blind || !st) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
      <span className={`font-bold ${song.rerank ? "text-orange-600" : "text-violet-700/70"}`} title="Réponses des invités au blind test : artiste ou titre trouvé">
        trouvé par {st.found} sur {st.n}
      </span>
      {song.rerank && (
        <>
          <span className="text-orange-600">· {song.rerank === "hard" ? "peu trouvé : très difficile ?" : "souvent trouvé : normal ?"}</span>
          <button onClick={() => run({ action: "blindDecide", key: song.key, level: blindLevel(song) })} title="Garder ce niveau : seules les prochaines réponses compteront"
            className="font-bold text-gray-500 underline hover:text-gray-900">Garder ainsi</button>
        </>
      )}
    </span>
  );
}

/* Année plus ancienne proposée par la vérification (MusicBrainz) : à
 * accepter ou refuser (plus reproposée). Une autre année : clic sur l'année. */
export function YearSuggest({ song, run, className = "" }) {
  if (!song.yearSuggest) return null;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 text-[11px] ${className}`} onClick={(e) => e.stopPropagation()}>
      <span className="font-bold text-orange-700" title={`Proposée par ${song.yearSuggestSrc || "la vérification"}`}>
        📅 {song.year ? <><s className="font-normal opacity-60">{song.year}</s> → </> : null}{song.yearSuggest} ?
      </span>
      <button onClick={stop(() => run({ action: "answerYear", key: song.key, accept: true }))}
        className="font-bold bg-green-600 text-white px-2 py-0.5 rounded-full">✓ {song.yearSuggest}</button>
      <button onClick={stop(() => run({ action: "answerYear", key: song.key, accept: false }))}
        className="font-bold bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">✕ {song.year ? `garder ${song.year}` : "ignorer"}</button>
      <a href={`https://www.google.com/search?q=${encodeURIComponent(`${song.artist} ${song.title} année de sortie`)}`} target="_blank" rel="noreferrer"
        onClick={(e) => e.stopPropagation()} title="Chercher l'année sur le web (nouvel onglet)" className="font-bold text-gray-500 hover:text-gray-900 underline">🔎 chercher</a>
    </span>
  );
}
