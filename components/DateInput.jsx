"use client";
/*
 * Champ date commun à toutes les apps perf360 : calendrier natif du navigateur
 * (téléphone et ordinateur), ouvert au clic n'importe où dans le champ — pas
 * seulement sur la petite icône. Valeur au format AAAA-MM-JJ.
 * Props : celles d'un <input> (value/onChange ou defaultValue/onBlur, min, max…).
 * Utilitaires (aussi côté serveur) : lib/dates.js (todayInput, fmtDateFr).
 */
export default function DateInput({ className = "", onClick, ...props }) {
  return (
    <input
      type="date"
      lang="fr"
      {...props}
      onClick={(e) => {
        try { e.currentTarget.showPicker?.(); } catch (err) { /* navigateur sans showPicker : calendrier via l'icône */ }
        onClick?.(e);
      }}
      className={`cursor-pointer ${className}`}
    />
  );
}

export { todayInput, fmtDateFr } from "@/lib/dates";
