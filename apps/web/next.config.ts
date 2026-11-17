import type { NextConfig } from "next";

const config: NextConfig = {
  // Steward reads and writes the repo on the server, with Node's own module loading for its packages.
  serverExternalPackages: ["@steward/cli", "@steward/context", "@steward/scanner", "@steward/guard", "@steward/model"],
  poweredByHeader: false,
};

export default config;
