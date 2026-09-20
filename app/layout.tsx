import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keen — Your intentional YouTube feed",
  description: "Turn any YouTube playlist into an adaptive, distraction-free learning queue.",
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
