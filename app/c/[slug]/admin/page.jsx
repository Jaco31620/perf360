/*
 * Ancienne URL de l'admin d'instance (/c/<slug>/admin) → redirige vers /<slug>/admin.
 */
import { redirect } from "next/navigation";

export default async function LegacyCampaignAdminRedirect({ params }) {
  const { slug } = await params;
  redirect(`/${slug}/admin`);
}
