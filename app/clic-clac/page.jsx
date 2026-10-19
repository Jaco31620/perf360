"use client";
/*
 * Clic-Clac — page d'accueil : présentation, accès à un album par son code,
 * demande d'utilisation (formulaire de contact), accès organisateur / super-admin.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { normalizeCode, isAlbumCode } from "@/lib/clicclac/settings";
import { api, storage } from "@/components/clicclac/client";

export default function ClicClacHome() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [orga, setOrga] = useState(false);
  const [pin, setPin] = useState("");
  const [orgaCode, setOrgaCode] = useState("");
  const [orgaErr, setOrgaErr] = useState("");
  const [form, setForm] = useState({ name: "", email: "", message: "", website: "" });
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);

  const c = normalizeCode(code);
  const go = (e) => { e.preventDefault(); if (isAlbumCode(c)) router.push(`/clic-clac/${c}`); };

  const loginOrga = async (e) => {
    e.preventDefault();
    setOrgaErr("");
    const oc = normalizeCode(orgaCode);
    try {
      const { token } = await api(`/${oc}/auth`, { method: "POST", body: { pin } });
      storage.set(`cc_admin_${oc}`, token);
      router.push(`/clic-clac/${oc}/admin`);
    } catch (err) { setOrgaErr(err.message); }
  };

  const contact = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api("/contact", { method: "POST", body: form }); setSent({ ok: true }); }
    catch (err) { setSent({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };

  const input = "w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 focus:border-[#ff5a5f] outline-none";

  return (
    <div className="min-h-screen bg-[#fff8f3]">
      <section className="bg-gradient-to-br from-[#ff5a5f] to-[#ffb347] text-white px-4 pt-6 pb-24">
        <div className="max-w-4xl mx-auto">
          <Link href="/" className="text-sm font-bold opacity-90">← perf360</Link>
          <div className="text-center mt-10 space-y-4">
            <img src="/icon-clicclac.svg" alt="" className="w-20 h-20 mx-auto rounded-3xl shadow-xl" />
            <h1 className="text-5xl sm:text-6xl font-black tracking-tight">Clic-Clac</h1>
            <p className="text-xl sm:text-2xl text-white/90 max-w-2xl mx-auto">Le photo booth virtuel de vos événements.</p>
          </div>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 -mt-14 space-y-8 pb-16">
        <form onSubmit={go} className="bg-white rounded-3xl shadow-xl p-6 sm:p-8 flex flex-col sm:flex-row gap-3 items-stretch">
          <div className="flex-1">
            <p className="font-bold text-gray-900 mb-2">Vous avez un code d'album ?</p>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8}
              className={`${input} text-2xl font-black tracking-[0.3em] uppercase text-center sm:text-left`} />
          </div>
          <button disabled={!isAlbumCode(c)} className="sm:self-end bg-[#ff5a5f] disabled:opacity-40 text-white font-bold px-8 py-3.5 rounded-full">Ouvrir l'album</button>
        </form>

        <section className="grid sm:grid-cols-3 gap-4">
          {[
            ["📱", "Avec son téléphone", "Les invités scannent un QR code et prennent des photos, sans application à installer."],
            ["🖼️", "Un album partagé", "Toutes les photos dans une galerie privée, à revoir et télécharger après l'événement."],
            ["📺", "En direct à l'écran", "Mode borne pour un appareil dédié, et diaporama en direct sur un grand écran."],
          ].map(([e, t, d]) => (
            <div key={t} className="bg-white rounded-2xl p-6 border border-orange-100">
              <div className="text-3xl mb-2">{e}</div>
              <h3 className="font-bold text-gray-900 mb-1">{t}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{d}</p>
            </div>
          ))}
        </section>
        <p className="text-center text-gray-500 text-sm">Cadres et filtres au choix · bandes « cabine » de 4 photos · modération · album supprimé automatiquement après l'événement.</p>

        <section className="bg-white rounded-3xl shadow-sm border border-orange-100 p-6 sm:p-8">
          <h2 className="text-2xl font-black text-gray-900 mb-1">Vous organisez un événement ?</h2>
          <p className="text-gray-500 mb-5">Clic-Clac est proposé sur demande. Écrivez-moi et je vous ouvre un album.</p>
          {sent?.ok ? (
            <p className="bg-green-50 text-green-700 rounded-2xl p-5 font-semibold">✓ Message envoyé, je vous réponds rapidement !</p>
          ) : (
            <form onSubmit={contact} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Votre nom" className={input} />
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Votre e-mail" className={input} />
              </div>
              <textarea required rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Type d'événement, date, nombre d'invités…" className={`${input} resize-none`} />
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" aria-hidden="true" />
              {sent && !sent.ok && <p className="text-red-600 text-sm">{sent.text}</p>}
              <button disabled={busy} className="bg-gray-900 text-white font-bold px-8 py-3 rounded-full disabled:opacity-50">{busy ? "Envoi…" : "Envoyer"}</button>
            </form>
          )}
        </section>

        <footer className="text-center text-sm text-gray-400 space-x-4">
          <button onClick={() => setOrga((v) => !v)} className="underline hover:text-gray-600">Espace organisateur</button>
          <Link href="/clic-clac/super" className="underline hover:text-gray-600">Super-admin</Link>
        </footer>
        {orga && (
          <form onSubmit={loginOrga} className="max-w-sm mx-auto bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <input value={orgaCode} onChange={(e) => setOrgaCode(e.target.value.toUpperCase())} placeholder="Code de l'album" className={input} />
            <input value={pin} onChange={(e) => setPin(e.target.value.toUpperCase())} placeholder="Code organisateur" className={input} />
            {orgaErr && <p className="text-red-600 text-sm">{orgaErr}</p>}
            <button className="w-full bg-[#ff5a5f] text-white font-bold py-3 rounded-full">Se connecter</button>
          </form>
        )}
      </div>
    </div>
  );
}
