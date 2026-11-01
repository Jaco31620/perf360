"use client";
/* Boutons d'envoi d'un message : copier, partager (téléphone), WhatsApp, SMS,
 * e-mail. `dark` : sur fond sombre (régie, télécommande). */
import { useEffect, useState } from "react";

export default function ShareActions({ subject, message, dark = false, className = "" }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(!!navigator.share); }, []);
  const enc = encodeURIComponent(message);
  const btn = dark
    ? "text-sm font-bold px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20"
    : "text-sm font-bold px-3.5 py-2 rounded-full bg-white border border-gray-200 hover:border-gray-300";
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch (e) { /* refusé */ }
  };
  return (
    <div className={`flex flex-wrap gap-2 items-center ${className}`}>
      <button type="button" onClick={copy} className={`text-sm font-bold px-3.5 py-2 rounded-full ${dark ? "bg-fuchsia-600 hover:bg-fuchsia-700" : "bg-gray-900 text-white"}`}>
        {copied ? "✓ Copié" : "Copier"}
      </button>
      {canShare && (
        <button type="button" onClick={async () => { try { await navigator.share({ title: subject, text: message }); } catch (e) { /* annulé */ } }} className={btn}>Partager…</button>
      )}
      <a href={`https://wa.me/?text=${enc}`} target="_blank" rel="noopener noreferrer" className={btn}>💬 WhatsApp</a>
      <a href={`sms:?&body=${enc}`} className={btn}>📱 SMS</a>
      <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${enc}`} className={btn}>✉️ E-mail</a>
    </div>
  );
}
