import { AppShell } from "@/components/AppShell";

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <AppShell lang={decodeURIComponent(lang)}>{children}</AppShell>;
}
