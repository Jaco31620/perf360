import Presenter from "@/components/nuage/Presenter";

export const metadata = { title: "Présentation — Nuage de mots" };

export default async function NuagePresenterPage({ params }) {
  const { code } = await params;
  return <Presenter code={code} />;
}
