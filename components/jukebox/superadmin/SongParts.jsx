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

/* Étiquette blind test de la chanson, d'un seul tenant : 🕵️ (utilisée ou non)
 * et, collé à droite quand elle l'est, 🎓 très difficile (au plus 1 titre sur
 * N, si la soirée les inclut). `sub` : précision sous 🕵️ (revue). */
export function BlindTag({ song, onBlind, onHard, big = false, sub = null, blindKey, hardKey }) {
  const hard = song.difficulty >= 2;
  const k = (x) => x && <kbd className="ml-1 text-[10px] font-mono bg-black/10 rounded px-1">{x}</kbd>;
  // 🎓 : ambre quand très difficile (l'émoji, sombre, reste lisible), violet pâle sinon
  const hardCls = hard ? "bg-amber-300 text-amber-950 hover:bg-amber-200" : "bg-violet-100 text-violet-600 hover:text-violet-900";
  const hardTitle = hard ? "Très difficile : pioché seulement si la soirée inclut les titres très difficiles (au plus 1 sur N). Cliquer : difficulté normale"
    : "Difficulté normale. Cliquer si ce titre est trop dur pour une soirée grand public";
  if (big) { // revue : 🕵️ en haut, 🎓 en bandeau dessous (tient dans la case)
    return (
      <div className={`flex flex-col min-w-0 rounded-xl overflow-hidden ${song.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500"}`}>
        <button onClick={onBlind} title={song.blind ? "Retirer du blind test (étiquette de la chanson : toutes ses versions)" : "Utiliser dans le blind test (version paroles, sinon clip)"}
          className={`flex-1 text-sm font-bold px-3 py-2 text-left min-w-0 ${song.blind ? "" : "hover:text-gray-900"}`}>
          🕵️ {song.blind ? "Blind test" : "Pas au blind"}{k(blindKey)}
          {sub && <span className="block text-[10px] font-semibold opacity-80">{sub}</span>}
        </button>
        {song.blind && (
          <button onClick={onHard} title={hardTitle} className={`text-xs font-bold px-3 py-1 text-left ${hardCls}`}>
            🎓 {hard ? "Très difficile" : "Difficulté normale"}{k(hardKey)}
          </button>
        )}
      </div>
    );
  }
  return (
    <span className="inline-flex items-stretch">
      <button onClick={onBlind} title={song.blind ? "Retirer du blind test (étiquette de la chanson : toutes ses versions)" : "Utiliser dans le blind test (version paroles, sinon clip)"}
        className={`text-[11px] font-bold px-2 py-0.5 whitespace-nowrap ${song.blind ? "bg-violet-600 text-white rounded-l-full" : "bg-gray-100 text-gray-400 hover:text-gray-700 rounded-full"}`}>
        🕵️ {song.blind ? "Blind test" : "Blind test ?"}
      </button>
      {song.blind && (
        <button onClick={onHard} title={hardTitle} className={`text-[11px] font-bold px-2 py-0.5 whitespace-nowrap rounded-r-full ${hardCls}`}>
          🎓{hard ? " Très difficile" : " ?"}
        </button>
      )}
    </span>
  );
}

/* Réponses des invités au blind test (« trouvé par 2 sur 11 ») et, si les
 * stats le suggèrent, reclassement ou « Garder ainsi » (le titre ne revient
 * plus dans 📊 À reclasser). */
export function BlindStat({ song, run }) {
  const st = song.blindStat;
  if (!song.blind || !st) return null;
  const hard = song.difficulty >= 2;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
      <span className={`font-bold ${song.rerank ? "text-orange-600" : "text-violet-700/70"}`} title="Réponses des invités au blind test : artiste ou titre trouvé">
        trouvé par {st.found} sur {st.n}
      </span>
      {song.rerank && (
        <>
          <span className="text-orange-600">· {song.rerank === "hard" ? "peu trouvé : très difficile ?" : "souvent trouvé : normal ?"}</span>
          <button onClick={() => run({ action: "difficultySong", key: song.key, hard })} title="Garder ce niveau : le titre ne reviendra plus dans « À reclasser »"
            className="font-bold text-gray-500 underline hover:text-gray-900">Garder ainsi</button>
        </>
      )}
    </span>
  );
}
