import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Podify: any research paper, a podcast episode in a minute",
  description: "Paste an arXiv or PDF link and get a two-minute podcast episode that explains the paper for you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
