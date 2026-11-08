import type { Page } from "../App";

interface NavbarProps {
  current: Page;
  onNavigate: (page: Page) => void;
}

const links: { id: Page; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "settings", label: "Settings" },
  { id: "billing", label: "Billing" },
];

export function Navbar({ current, onNavigate }: NavbarProps) {
  return (
    <header className="border-b border-[#e5e7eb] bg-white">
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-[18px]">
        <div className="flex items-center gap-[10px]">
          <img src="/logo.svg" width="28" height="28" />
          <span className="text-base font-semibold text-[#111827]">Acme Metrics</span>
        </div>
        <ul className="flex items-center gap-6">
          {links.map((link) => (
            <li key={link.id}>
              <button
                type="button"
                onClick={() => onNavigate(link.id)}
                className={`text-sm ${
                  current === link.id ? "font-medium text-[#3b82f6]" : "text-[#6b7280] hover:text-[#1f2937]"
                }`}
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
