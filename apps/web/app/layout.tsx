import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steward",
  description: "The self-maintaining design system.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen bg-white text-gray-900 antialiased">
        <Sidebar />
        <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
      </body>
    </html>
  );
}
