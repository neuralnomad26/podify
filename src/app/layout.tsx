import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Podify — any article, a podcast in seconds",
  description: "Paste a link and get a narrated two-minute podcast episode.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
