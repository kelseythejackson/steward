"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The four parts of Steward, as in the wireframes' sidebar. */
export const NAV = [
  { href: "/setup", label: "Setup" },
  { href: "/brief", label: "Brief" },
  { href: "/review", label: "Review" },
  { href: "/report", label: "Report" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-6 border-r border-gray-200 bg-gray-50 px-4 py-6">
      <div className="flex items-center gap-3 px-2">
        <span aria-hidden="true" className="size-6 rounded-md bg-gray-900" />
        <span className="text-base font-semibold text-gray-900">Steward</span>
      </div>
      <nav aria-label="Main">
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    active ? "bg-gray-200 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
