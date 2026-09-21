import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev — Watch YouTube in a better order",
  description: "Put the most useful videos first and share a calm, focused YouTube feed.",
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
