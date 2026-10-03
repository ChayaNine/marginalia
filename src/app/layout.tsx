import type { Metadata } from "next";
import "@fontsource-variable/inter";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Marginalia",
    template: "%s · Marginalia",
  },
  description:
    "Grounded Q&A over your own documents: every answer cites the exact passage it came from, and a human approves it before it ships.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-20 sm:px-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Logo className="text-[15px] text-ink-muted" />
            <p>Answers with receipts. Drafts are suggestions; a person approves every one.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
