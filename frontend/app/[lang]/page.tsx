import { redirect } from "next/navigation";

export default async function LangIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  redirect(`/${lang}/today`);
}
