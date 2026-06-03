import AmiInvisible from "@/components/AmiInvisible";

export const metadata = {
  title: "Ami Invisible — perf360",
  description: "Organisez votre tirage Ami Invisible en toute confidentialité.",
  manifest: "/manifest-ami-invisible.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ami Invisible",
  },
  icons: {
    apple: "/icon-ami-invisible.svg",
  },
};

export default function AmiInvisiblePage() {
  return <AmiInvisible />;
}
