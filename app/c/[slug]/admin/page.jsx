"use client";
/*
 * Admin d'une instance, accessible via /c/<slug>/admin.
 * Charge la campagne par son slug, puis rend l'admin scopé.
 */
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { loadCampaignBySlug, PageShell, Loader, C } from "../../../ffbb-test/shared";
import AdminApp from "../../../ffbb-test/AdminApp";

export default function CampaignAdminPage() {
  const { slug } = useParams();
  const [campaign, setCampaign] = useState(undefined);

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
            Instance introuvable.
          </div>
        </div>
      </PageShell>
    );
  }
  return <AdminApp campaign={campaign} />;
}
