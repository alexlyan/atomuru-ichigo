import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";

// Japanese faces are large; they are self-hosted by next/font but not preloaded.
const mincho = Shippori_Mincho({
  weight: ["500", "700"],
  subsets: ["latin"],
  variable: "--font-mincho",
  display: "swap",
  preload: false,
});

const gothic = Zen_Kaku_Gothic_New({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-gothic",
  display: "swap",
  preload: false,
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ichigo",
  description: "A personal staged-SRS notebook for learning Japanese.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#15171c" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${mincho.variable} ${gothic.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
