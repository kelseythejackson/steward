import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import "./globals.css";

export const metadata: Metadata = {
  // Each page sets its own title ("Report · Steward"), so tabs, history and screen readers can tell them apart.
  title: { default: "Steward", template: "%s · Steward" },
  description: "The self-maintaining design system.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* Below md the sidebar becomes a strip across the top, so the page reflows at narrow widths and high zoom. */}
      <body className="flex min-h-screen flex-col bg-white text-gray-900 antialiased md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </body>
    </html>
  );
}
