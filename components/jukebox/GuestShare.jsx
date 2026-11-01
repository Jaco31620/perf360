"use client";
/* Régie / télécommande : faire venir les invités (affiche à imprimer,
 * message à envoyer dans le groupe de la soirée) et mode d'emploi. */
import { useEffect, useState } from "react";
import Link from "next/link";
import ShareActions from "./ShareActions";
import { guestText } from "@/lib/jukeboxMessages";

export default function GuestShare({ code, name, endsAt }) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const tile = "flex items-center justify-center gap-1.5 text-center font-bold bg-white/10 hover:bg-white/20 active:bg-white/20 rounded-2xl py-3 text-sm";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/jukebox/${code}/affiche`} target="_blank" className={tile}>🖨️ Affiche à imprimer</Link>
        <button type="button" onClick={() => setOpen((v) => !v)} className={`${tile} ${open ? "!bg-fuchsia-600" : ""}`}>💬 Lien pour les invités</button>
      </div>
      {open && origin && (
        <div className="bg-white/5 rounded-2xl p-3 space-y-2">
          <pre className="whitespace-pre-wrap break-words text-xs text-white/80 font-sans">{guestText({ origin, code, name })}</pre>
          <ShareActions dark subject={`Jukebox « ${name} »`} message={guestText({ origin, code, name })} />
        </div>
      )}
      {endsAt && <p className="text-center text-xs text-white/60">⏳ Soirée ouverte jusqu'au {new Date(endsAt).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · <Link href={`/jukebox?prolonger=${code}`} className="underline">demander une prolongation</Link></p>}
      <Link href="/jukebox/aide" target="_blank" className="block text-center text-xs text-white/50 hover:text-white underline">❓ Mode d'emploi</Link>
    </div>
  );
}
