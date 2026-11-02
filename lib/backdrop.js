/*
 * Fermeture d'une fenêtre par clic sur le fond : seulement si l'appui ET le
 * relâchement ont lieu sur le fond. Sans ça, sélectionner le texte d'un champ
 * en glissant et relâcher la souris hors de la fenêtre la ferme (le navigateur
 * envoie le clic au fond). L'état est rangé sur l'élément (survit aux rendus).
 */
export function backdropClose(close) {
  return {
    onMouseDown: (e) => { e.currentTarget.dataset.down = e.target === e.currentTarget ? "1" : ""; },
    onClick: (e) => {
      const ok = e.currentTarget.dataset.down === "1" && e.target === e.currentTarget;
      e.currentTarget.dataset.down = "";
      if (ok) close(e);
    },
  };
}
