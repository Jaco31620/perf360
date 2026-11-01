"use client";
/*
 * Jukebox — formulaire « Demander un accès » (accueil) : envoie un e-mail au
 * propriétaire, qui répond avec un code d'activation. Même logique que Clic-Clac.
 */
import { useState } from "react";

export default function AccessRequest({ open: initialOpen = false, intro }) {
  const [open, setOpen] = useState(initialOpen);
  const [form, setForm] = useState({ name: "", email: "", date: "", guests: "", message: "", website: "" });
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const input = "w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 focus:border-fuchsia-500 outline-none";

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/jukebox/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      setSent(r.ok ? { ok: true } : { ok: false, text: d.error || "Envoi impossible." });
    } catch (err) { setSent({ ok: false, text: "Pas de connexion, réessayez." }); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full bg-white rounded-3xl p-5 shadow-xl text-left flex items-center gap-4">
        <span className="text-3xl">✉️</span>
        <span className="flex-1">
          <span className="block font-bold text-gray-900">Pas encore de code d'activation ?</span>
          <span className="block text-sm text-gray-500">Le Jukebox est proposé sur demande : faites votre demande, je vous envoie votre accès.</span>
        </span>
        <span className="text-xl text-fuchsia-600">→</span>
      </button>
    );
  }
  return (
    <section className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl">
      <h2 className="text-xl font-bold text-gray-900 mb-1">✉️ Demander un accès</h2>
      <p className="text-sm text-gray-500 mb-4">{intro || "Le Jukebox est proposé sur demande. Dites-m'en un peu plus sur votre soirée : je vous réponds par e-mail avec votre code d'activation."}</p>
      {sent?.ok ? (
        <p className="bg-green-50 text-green-700 rounded-2xl p-5 font-semibold">✓ Demande envoyée ! Vous recevrez votre code d'activation par e-mail.</p>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input required value={form.name} onChange={set("name")} placeholder="Votre nom" className={input} autoComplete="name" />
            <input required type="email" value={form.email} onChange={set("email")} placeholder="Votre e-mail" className={input} autoComplete="email" />
            <input value={form.date} onChange={set("date")} placeholder="Date de la soirée" className={input} />
            <input value={form.guests} onChange={set("guests")} placeholder="Nombre d'invités (environ)" className={input} />
          </div>
          <textarea rows={3} value={form.message} onChange={set("message")} placeholder="Type de soirée, blind test, télé ou ordinateur… (facultatif)" className={`${input} resize-none`} />
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} className="hidden" aria-hidden="true" />
          {sent && !sent.ok && <p className="text-red-600 text-sm">{sent.text}</p>}
          <button disabled={busy} className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold px-8 py-3 rounded-full disabled:opacity-50">{busy ? "Envoi…" : "Envoyer la demande"}</button>
        </form>
      )}
    </section>
  );
}
