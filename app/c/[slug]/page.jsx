"use client";
/*
 * Formulaire public d'une instance, accessible via /c/<slug>.
 * Charge la campagne par son slug, puis rend le formulaire scopé.
 */
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { loadCampaignBySlug, PageShell, Loader, C } from "../../ffbb-test/shared";
import PublicForm from "../../ffbb-test/PublicForm";

export default function CampaignFormPage() {
  const { slug } = useParams();
  const [campaign, setCampaign] = useState(undefined); // undefined = chargement, null = introuvable

  useEffect(() => {
    let alive = true;
    loadCampaignBySlug(slug)
      .then((c) => { if (alive) setCampaign(c); })
      .catch((e) => { console.error(e); if (alive) setCampaign(null); });
    return () => { alive = false; };
  }, [slug]);

  if (campaign === undefined) return <Loader />;
  if (!campaign) {
    return (
      <PageShell>
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 16px" }}>
          <div style={{ maxWidth: 480, textAlign: "center", color: C.gray }}>
            Cette page n'existe pas ou n'est plus disponible.
          </div>
        </div>
      </PageShell>
    );
  }
  return (
    <PageShell>
      <PublicForm campaign={campaign} />
    </PageShell>
  );
}
