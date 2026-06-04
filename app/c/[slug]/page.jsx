/*
 * Ancienne URL des instances (/c/<slug>). Conservée pour les liens/QR existants :
 * redirige vers la nouvelle URL racine /<slug>.
 */
import { redirect } from "next/navigation";

export default async function LegacyCampaignRedirect({ params }) {
  const { slug } = await params;
  redirect(`/${slug}`);
}
