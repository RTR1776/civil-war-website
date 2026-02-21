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
  title: "Battle of Franklin | Civil War Immersive",
  description:
    "Interactive hour-by-hour battlefield visualization of the Battle of Franklin with division movements and guided narrative beats.",
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
