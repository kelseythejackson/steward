import { useState } from "react";
import { Navbar } from "./components/Navbar";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Billing } from "./pages/Billing";

export type Page = "dashboard" | "settings" | "billing";

export function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="min-h-screen bg-[#f9fafb] text-[#9ca3af]">
      <Navbar current={page} onNavigate={setPage} />
      <main className="mx-auto max-w-5xl px-[18px] py-8">
        {page === "dashboard" && <Dashboard />}
        {page === "settings" && <Settings />}
        {page === "billing" && <Billing />}
      </main>
    </div>
  );
}
