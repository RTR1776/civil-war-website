import type { Metadata } from "next";
import { Cormorant_Garamond, Spectral } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const spectral = Spectral({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "The Battle of Franklin — November 30, 1864",
  description:
    "A cinematic, interactive reconstruction of the Battle of Franklin: watch five hours of fighting unfold hour by hour on a hand-drawn 1864 map, from the grand assault to the fight in darkness.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${cormorant.variable} ${spectral.variable}`}>{children}</body>
    </html>
  );
}
