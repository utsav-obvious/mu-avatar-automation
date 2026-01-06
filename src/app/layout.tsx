import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Audio Audit | Pronunciation Auditing Tool",
  description: "Internal tool for auditing proper noun pronunciation with ElevenLabs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.className} antialiased selection:bg-indigo-500/30`}>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
