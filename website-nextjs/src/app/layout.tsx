import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMCP Editor — One prompt. Five models. Zero hand-holding.",
  description: "The AI editor that delegates, not suggests.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body className={`antialiased bg-bg-page text-text-secondary font-sans`}>
        {children}
      </body>
    </html>
  );
}
