import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Debate.Me",
  description: "Short, timed video debates to reach agreement.",
  icons: [
    { rel: "icon", url: "/favicon.svg", type: "image/svg+xml" },
    { rel: "icon", url: "/favicon.png", sizes: "256x256" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon.png" },
  ],
  // Optional: improves browser UI colors on mobile
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100`}>
        <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <a
              href="/"
              className="font-semibold text-[var(--text)] hover:text-[var(--brand)]"
              aria-label="Go to Debate.Me home"
            >
              Debate.Me
            </a>
            <nav className="text-sm space-x-4" aria-label="Main navigation">
              <a className="text-zinc-300 hover:text-white" href="/profile" aria-label="Profile">
                Profile
              </a>
              <a
                className="text-zinc-300 hover:text-white"
                href="/room/deb-test-123"
                aria-label="Join test room"
              >
                Room
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mt-10 border-t border-zinc-800 text-xs text-zinc-400 py-6 text-center">
          © {new Date().getFullYear()} Debate.Me
        </footer>
      </body>
    </html>
  );
}
