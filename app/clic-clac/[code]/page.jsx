import GuestApp from "@/components/clicclac/GuestApp";

export default async function ClicClacAlbumPage({ params }) {
  const { code } = await params;
  return <GuestApp code={code.toUpperCase()} />;
}
