/*
 * Jukebox — règles du mode clip (v2, SQL v37), sans accès serveur (testées).
 *
 * Version clip d'une chanson :
 *   wait   : en attente de recherche (aucune version, ou clip validé disparu) ;
 *   todo   : vidéo proposée, à vérifier (recherche, lien collé) ;
 *   ok     : clip validé ;
 *   noclip : « pas de clip » décidé en revue (vidéo refusée gardée, jamais jouée).
 * Version paroles validée = validée et pas disparue.
 *
 * Soirée clip, un invité choisit un titre (playFor) :
 *   ok     → le clip ;
 *   noclip → la version paroles (cherchée si elle n'existe pas) ;
 *   todo   → la version paroles validée s'il y en a une, sinon le candidat ;
 *   wait   → recherche du clip (passe une fois pour cet invité, puis revue) ;
 *            quota du jour presque épuisé et version paroles connue : celle-ci.
 * Tout ce qui n'est pas un clip passe avec la mention « pas de clip validé ».
 */

export function clipState(row) {
  if (!row) return "wait";
  if (row.no_clip) return "noclip";
  if (row.missing) return "wait";
  return row.validated ? "ok" : "todo";
}

export const parolesOk = (row) => !!row && !!row.validated && !row.missing;
export const parolesUsable = (row) => !!row && !row.missing;

/* Recherches YouTube du jour (sur ~100) au-delà desquelles une soirée ne
 * cherche plus de clip pour un titre dont la version paroles est connue. */
export const CLIP_SEARCH_MAX = 80;

/* → "clip" (version clip connue), "paroles" (version paroles connue),
 *   "searchClip", "searchParoles". */
export function playFor(clip, paroles, { searchesToday = 0 } = {}) {
  const st = clipState(clip);
  if (st === "ok") return "clip";
  if (st === "noclip") return parolesUsable(paroles) ? "paroles" : "searchParoles";
  if (st === "todo") return parolesOk(paroles) ? "paroles" : "clip";
  // en attente : on cherche, sauf quota presque épuisé et version paroles connue
  if (parolesUsable(paroles) && searchesToday >= CLIP_SEARCH_MAX) return "paroles";
  return "searchClip";
}

/* « Pas de clip » : seulement une version clip existante (vidéo revue) d'une
 * chanson dont la version paroles est validée. → message d'erreur ou null. */
export function noClipError(clip, paroles) {
  if (!clip) return "Aucune vidéo clip à refuser.";
  if (!parolesOk(paroles)) return "Validez d'abord la version paroles : c'est elle qui passera à la place du clip.";
  return null;
}
