import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/auth-provider";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev — watch what you meant to watch",
  description: "Your YouTube playlists one chapter at a time, ranked by lenses you write, and feeds you design and send to the people you care about.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#12110f", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
