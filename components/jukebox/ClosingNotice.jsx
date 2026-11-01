"use client";
/*
 * Fermeture d'une soirée côté organisateur :
 *  - ClosingBanner : bandeau quand la fermeture approche (< 24 h), ou vue
 *    super-admin d'une soirée déjà fermée ;
 *  - ClosedMessage : page « soirée fermée » (à la main ou par son délai), avec
 *    la demande de prolongation.
 */
import Link from "next/link";
import { formatCode } from "./storage";

const fmt = (ms) => new Date(ms).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function ClosingBanner({ endsAt }) {
  if (!endsAt) return null;
  const left = endsAt - Date.now();
  if (left <= 0) return <p className="bg-red-600 text-white text-sm font-semibold text-center px-4 py-2">🔒 Soirée fermée depuis le {fmt(endsAt)} · vue super-admin (invités et organisateur n'y ont plus accès)</p>;
  if (left > 24 * 3600e3) return null;
  return <p className="bg-amber-500 text-gray-950 text-sm font-semibold text-center px-4 py-2">⏳ La soirée se fermera {fmt(endsAt)}. Besoin de plus de temps ? Demandez une prolongation (🔧 Outils / ⚙️ Plus).</p>;
}

/* missing : { closed, reason } renvoyé par l'API (404). */
export function closedText(code, missing) {
  if (!missing?.closed) return `La soirée ${formatCode(code)} n'existe pas (ou plus).`;
  return missing.reason === "manual"
    ? `🔒 La soirée ${formatCode(code)} a été fermée par l'administrateur.`
    : `🔒 La soirée ${formatCode(code)} est fermée : son délai d'ouverture est passé.`;
}

export function ClosedMessage({ code, missing }) {
  return (
    <div className="space-y-5 max-w-sm">
      <p className="text-4xl">{missing?.closed ? "🔒" : "🤔"}</p>
      <p>{closedText(code, missing)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {missing?.closed && <Link href={`/jukebox?prolonger=${code}`} className="bg-fuchsia-600 text-white font-bold px-5 py-3 rounded-full">Demander une prolongation</Link>}
        <Link href="/jukebox" className="bg-white/10 text-white font-bold px-5 py-3 rounded-full">Retour</Link>
      </div>
    </div>
  );
}

/* Lecture de la réponse 404 de l'API : { closed, reason } ou true (inconnue). */
export async function missingFrom(res) {
  const d = await res.json().catch(() => ({}));
  return d.closed ? { closed: true, reason: d.reason } : true;
}
