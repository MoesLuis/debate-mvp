import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Debate.Me",
  description: "Short, timed video debates to reach agreement.",
  icons: [
    { rel: "icon", url: "/favicon.svg", type: "image/svg+xml" },
    { rel: "icon", url: "/favicon.png", sizes: "256x256" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon.png" },
  ],
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100`}>
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mt-10 border-t border-zinc-800 text-xs text-zinc-400 py-6 text-center">
          © {new Date().getFullYear()} Debate.Me
        </footer>
      </body>
    </html>
  );
}
