/*
 * Route serveur PUBLIQUE — renvoi du code après un conflit de licence. Le client
 * ne possède qu'un jeton opaque (resendToken) émis par /api/ffbb/register : il ne
 * connaît ni l'e-mail ni le code de l'inscrit concerné. Le serveur résout le jeton,
 * recharge l'inscription et lui renvoie son code par e-mail.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeConfig } from "@/app/ffbb-test/configDefaults";
import { sendWelcomeEmail } from "@/lib/ffbbMail";
import { verifyResendToken } from "@/lib/ffbbAuth";

export const runtime = "nodejs";

export async function POST(req) {
  let payload;
  try { payload = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const p = verifyResendToken(payload?.resendToken);
  if (!p) return Response.json({ error: "Lien expiré. Merci de recommencer." }, { status: 400 });

  try {
    const sb = getSupabaseAdmin();
    const { data: reg, error } = await sb
      .from("ffbb_registrations").select("*").eq("id", p.rid).eq("campaign_id", p.cid).maybeSingle();
    if (error) throw error;
    if (!reg) return Response.json({ error: "Inscription introuvable." }, { status: 404 });

    const { data: camp } = await sb.from("ffbb_campaigns").select("config").eq("id", p.cid).maybeSingle();
    const config = normalizeConfig(camp?.config);

    await sendWelcomeEmail(reg, config);
    return Response.json({ status: "resent" });
  } catch (e) {
    console.error("resend POST:", e);
    return Response.json({ error: "L'envoi a échoué. Merci de réessayer." }, { status: 502 });
  }
}
