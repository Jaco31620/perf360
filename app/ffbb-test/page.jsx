"use client";
/*
 * Formulaire public licenciés FFBB × BLACKROLL.
 * Attribution d'un code de réduction : on réserve un code « available » dans
 * ffbb_codes, on crée la ligne ffbb_registrations, puis on envoie l'e-mail réel
 * via /api/ffbb/send. Détection des doublons e-mail / licence + renvoi de code.
 *
 * Dispositif autonome : AUCUN lien vers l'accueil perf360.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  C, nb, loadConfig, sendWelcomeEmail, validateLicense, maskDescription, maskEmail,
  CoBrandHeader, Card, Field, Check, PageShell, Loader, btnPrimary, btnGhost,
} from "./shared";

export default function FfbbPublicPage() {
  const [config, setConfig] = useState(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    loadConfig().then(setConfig).catch((e) => { console.error(e); setLoadErr(true); });
  }, []);

  if (loadErr) {
    return (
      <PageShell>
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 16px" }}>
          <div style={{ maxWidth: 480, textAlign: "center", color: C.gray }}>
            Le formulaire est momentanément indisponible. Merci de réessayer plus tard.
          </div>
        </div>
      </PageShell>
    );
  }
  if (!config) return <Loader />;

  return (
    <PageShell>
      <PublicForm config={config} />
    </PageShell>
  );
}

function PublicForm({ config }) {
  const router = useRouter();
  const [f, setF] = useState({ prenom: "", nom: "", licence: "", email: "", newsletter: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [conflict, setConflict] = useState(null);

  const inputStyle = {
    width: "100%", padding: "13px 15px", borderRadius: 12, border: `1.5px solid ${C.cardLine}`,
    background: "#fff", color: C.ink, fontSize: 15, outline: "none", boxSizing: "border-box",
  };

  /* Réserve atomiquement un code disponible. Retourne le code ou null. */
  async function claimCode() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: free, error } = await supabase
        .from("ffbb_codes").select("code").eq("status", "available").limit(1).maybeSingle();
      if (error) throw error;
      if (!free) return null;
      const { data: claimed, error: upErr } = await supabase
        .from("ffbb_codes")
        .update({ status: "assigned" })
        .eq("code", free.code).eq("status", "available")
        .select();
      if (upErr) throw upErr;
      if (claimed && claimed.length === 1) return free.code; // on détient le code
      // sinon : pris entre-temps par quelqu'un d'autre → nouvelle tentative
    }
    return null;
  }

  async function submit() {
    if (busy) return;
    setErr("");
    if (!f.prenom.trim() || !f.nom.trim()) return setErr("Merci d'indiquer votre prénom et votre nom.");
    const lic = validateLicense(f.licence, config.license);
    if (!lic.ok) return setErr(lic.msg);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setErr("Adresse e-mail invalide.");

    const emailNorm = f.email.trim();
    const licNorm = f.licence.trim();
    setBusy(true);
    try {
      // Doublon e-mail → renvoi du code existant.
      const { data: byEmail } = await supabase
        .from("ffbb_registrations").select("*").ilike("email", emailNorm).limit(1).maybeSingle();
      if (byEmail) {
        await sendWelcomeEmail(byEmail, config);
        setDone({ ...byEmail, resent: true });
        return;
      }

      // Doublon licence → écran de conflit (renvoi possible vers l'adresse connue).
      // Ignoré si la demande de licence est désactivée (champ absent).
      if (config.license.enabled !== false && licNorm) {
        const { data: byLicence } = await supabase
          .from("ffbb_registrations").select("*").ilike("licence", licNorm).limit(1).maybeSingle();
        if (byLicence) { setConflict(byLicence); return; }
      }

      // Réservation d'un code.
      const code = await claimCode();
      if (!code) return setErr("Aucun code disponible pour le moment. Merci de réessayer plus tard.");

      // Création de l'inscription.
      const { data: reg, error: insErr } = await supabase
        .from("ffbb_registrations")
        .insert({
          prenom: f.prenom.trim(), nom: f.nom.trim(),
          licence: licNorm, email: emailNorm,
          newsletter: f.newsletter, code,
        })
        .select().single();
      if (insErr) {
        // On relâche le code réservé pour ne pas le perdre.
        await supabase.from("ffbb_codes").update({ status: "available", assigned_to: null }).eq("code", code);
        throw insErr;
      }

      // Lien code → inscription, puis envoi de l'e-mail réel.
      await supabase.from("ffbb_codes").update({ assigned_to: String(reg.id) }).eq("code", code);
      await sendWelcomeEmail(reg, config);
      setDone(reg);
    } catch (e) {
      console.error(e);
      setErr("Une erreur est survenue. Merci de réessayer dans quelques instants.");
    } finally {
      setBusy(false);
    }
  }

  async function resendFromConflict() {
    if (!conflict || busy) return;
    setBusy(true);
    try {
      await sendWelcomeEmail(conflict, config);
      const r = conflict;
      setConflict(null);
      setDone({ ...r, resent: true, masked: true });
    } catch (e) {
      console.error(e);
      setErr("L'envoi a échoué. Merci de réessayer.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px 16px" }}>
        <div style={{ width: "100%", maxWidth: 560 }}>
          <CoBrandHeader config={config} />
          <Card>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: C.green, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <Check size={30} color={C.black} strokeWidth={3} />
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: "0 0 8px", letterSpacing: "-0.5px" }}>{done.resent ? "Code renvoyé" : "C'est confirmé" + nb + "!"}</h2>
            <p style={{ color: "#555", margin: "0 0 18px", fontSize: 15, lineHeight: 1.6 }}>
              {done.resent
                ? <>Vous étiez déjà inscrit. Votre code personnel vous a été renvoyé par e-mail à <b>{done.masked ? maskEmail(done.email) : done.email}</b>.</>
                : <>Votre code personnel vient de vous être envoyé par e-mail à <b>{done.email}</b>.</>}
            </p>
            <div style={{ padding: "16px 18px", background: "#f3f3e8", borderRadius: 12, fontSize: 14, color: "#444", lineHeight: 1.55 }}>
              Consultez votre boîte de réception pour le récupérer. Pensez à vérifier vos courriers indésirables si vous ne le voyez pas d'ici quelques minutes.
            </div>
            <button onClick={() => { setDone(null); setErr(""); setF({ prenom: "", nom: "", licence: "", email: "", newsletter: false }); }}
              style={btnPrimary}>Nouvelle inscription</button>
          </Card>
        </div>
      </div>
    );
  }

  if (conflict) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px 16px" }}>
        <div style={{ width: "100%", maxWidth: 480 }}>
          <CoBrandHeader config={config} />
          <Card>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: C.ink, margin: "0 0 10px", letterSpacing: "-0.5px" }}>Licence déjà inscrite</h2>
            <p style={{ color: "#555", margin: "0 0 16px", fontSize: 15, lineHeight: 1.6 }}>
              Ce numéro de licence a déjà reçu un code, associé à l'adresse <b>{maskEmail(conflict.email)}</b>.
            </p>
            <p style={{ color: "#666", margin: "0 0 18px", fontSize: 14, lineHeight: 1.55 }}>
              Si cette adresse est bien la vôtre, vous pouvez vous faire renvoyer votre code. Sinon, vérifiez le numéro saisi.
            </p>
            {err && <div style={{ background: "#fdecec", color: "#b3261e", padding: "11px 14px", borderRadius: 10, fontSize: 13.5, marginBottom: 14 }}>{err}</div>}
            <button onClick={resendFromConflict} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? "Envoi…" : "Renvoyer le code à cette adresse"}</button>
            <button onClick={() => { setConflict(null); setErr(""); }} style={{ ...btnGhost, marginTop: 8 }}><ArrowLeft size={15} /> Modifier mes informations</button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "40px 16px" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <CoBrandHeader config={config} />
        <Card>
          <h1 style={{ fontSize: 27, fontWeight: 800, color: C.ink, margin: "0 0 6px", letterSpacing: "-0.6px" }}>{config.formTitle}</h1>
          <div style={{ color: "#666", margin: "0 0 22px", fontSize: 14.5, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: config.formIntro }} />

          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <Field label="Prénom"><input style={inputStyle} value={f.prenom} onChange={e => setF({ ...f, prenom: e.target.value })} /></Field>
            <Field label="Nom"><input style={inputStyle} value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} /></Field>
          </div>
          {config.license.enabled !== false && (
            <div style={{ marginBottom: 14 }}>
              <Field label="Numéro de licence">
                <input style={inputStyle} value={f.licence} onChange={e => setF({ ...f, licence: e.target.value })} placeholder={config.license.mode === "mask" ? maskDescription(config.license.mask) : ""} />
              </Field>
            </div>
          )}
          <div style={{ marginBottom: 18 }}>
            <Field label="Adresse e-mail"><input style={inputStyle} type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", marginBottom: 20 }}>
            <input type="checkbox" checked={f.newsletter} onChange={e => setF({ ...f, newsletter: e.target.checked })}
              style={{ marginTop: 3, width: 18, height: 18, accentColor: C.greenDark }} />
            <span style={{ fontSize: 13.5, color: "#555", lineHeight: 1.45 }}>{config.newsletterLabel}</span>
          </label>

          {err && <div style={{ background: "#fdecec", color: "#b3261e", padding: "11px 14px", borderRadius: 10, fontSize: 13.5, marginBottom: 14 }}>{err}</div>}

          <button onClick={submit} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? "Traitement…" : <>Recevoir mon code <ChevronRight size={18} /></>}</button>
        </Card>
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button onClick={() => router.push("/ffbb-test/admin")} style={{ background: "none", border: "none", color: C.gray, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>Espace administrateur</button>
        </div>
      </div>
    </div>
  );
}
