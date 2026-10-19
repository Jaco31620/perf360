import PhotoPage from "@/components/clicclac/PhotoPage";

export const metadata = { title: "Ma photo — Clic-Clac" };

export default async function ClicClacPhotoPage({ params }) {
  const { code, id } = await params;
  return <PhotoPage code={code.toUpperCase()} id={id} />;
}
