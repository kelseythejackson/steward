import type { Config } from "tailwindcss";

// Added in the first week. Half the team forgot these exist and
// kept pasting hex values from Figma instead.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#2563eb",
        ink: "#1f2937",
        muted: "#6b7280",
      },
    },
  },
  plugins: [],
} satisfies Config;
