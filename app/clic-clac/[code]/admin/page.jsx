import AdminApp from "@/components/clicclac/AdminApp";

export const metadata = { title: "Organisateur — Clic-Clac" };

export default async function ClicClacAdminPage({ params }) {
  const { code } = await params;
  return <AdminApp code={code.toUpperCase()} />;
}
