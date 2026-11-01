"use client";
import { SEARCH_MODES, RETENTION_CHOICES, retentionLabel } from "@/lib/jukebox";

export const CREATION_MODES = [
  { id: "open", label: "Tout le monde", hint: "Toute personne qui connaît l'adresse /jukebox peut créer une soirée." },
  { id: "code", label: "Avec un code", hint: "Chaque organisateur saisit son propre code d'activation (onglet 🎟️ Codes)." },
  { id: "super", label: "Super-admin seul", hint: "Vous créez les soirées ici et transmettez le lien régie." },
];
export const fmtDate = (ms) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const FR_NEXT = { true: false, false: null, null: true }; // clic sur la langue : 🇫🇷 → 🌍 → ❓
export const MODE_TAG = {
  normal: "bg-sky-100 text-sky-700",
  karaoke: "bg-fuchsia-100 text-fuchsia-700",
};

/* Conservation (jours après la dernière activité) ; value null = réglage global. */
export function RetentionSelect({ value, onChange, global, className = "" }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      title="Suppression automatique après ce délai sans activité"
      className={`border-2 border-gray-200 rounded-xl px-2 py-1.5 font-semibold ${className}`}>
      <option value="">Conservation par défaut{global ? ` (${retentionLabel(global)})` : ""}</option>
      {RETENTION_CHOICES.map((n) => <option key={n} value={n}>Conservée {retentionLabel(n)}</option>)}
    </select>
  );
}

export const modeLabel = (m) => SEARCH_MODES.find((x) => x.id === m)?.label || m;

/* Champ de recherche avec croix pour l'effacer (Échap efface aussi). */
export function SearchInput({ value, onChange, placeholder, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }}
        className="w-full border-2 border-gray-200 bg-white rounded-full pl-4 pr-9 py-1.5 text-sm focus:border-fuchsia-500 outline-none" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Effacer la recherche" title="Effacer"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs font-bold leading-6 text-center">✕</button>
      )}
    </div>
  );
}
