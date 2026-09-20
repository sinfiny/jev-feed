import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev — Publish a smarter video feed",
  description: "Analyze any public YouTube playlist and publish a ranked, distraction-aware learning feed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
