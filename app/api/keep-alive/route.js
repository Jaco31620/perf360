/*
 * Route serveur — PING DE MAINTIEN Supabase.
 *
 * Pourquoi : les projets Supabase en offre gratuite sont mis en pause après
 * ~7 jours d'inactivité. Une pause casserait tout le dispositif FFBB (formulaire
 * /ffbb-test + admin). Ce ping fait une requête triviale (count) sur la base, ce
 * qui réinitialise le compteur d'inactivité. Déclenché quotidiennement par le
 * Vercel Cron défini dans vercel.json.
 *
 * Sécurité : si la variable d'env CRON_SECRET est définie, on exige l'en-tête
 * « Authorization: Bearer <CRON_SECRET> » que Vercel envoie automatiquement à ses
 * crons. Sans secret, la route reste ouverte mais reste inoffensive (aucune
 * donnée renvoyée, aucune écriture).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ status: "error", reason: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const sb = getSupabaseAdmin();
    // Requête la plus légère possible : compte des lignes sans rapatrier de données.
    const { count, error } = await sb
      .from("ffbb_codes")
      .select("code", { count: "exact", head: true });
    if (error) throw error;
    return Response.json({ status: "ok", pinged: true, count: count ?? null });
  } catch (e) {
    return Response.json(
      { status: "error", reason: String(e?.message || e) },
      { status: 500 }
    );
  }
}
