import type { NextConfig } from "next";

const config: NextConfig = {
  // Steward reads the repo on the server; nothing about it is sent anywhere.
  poweredByHeader: false,
};

export default config;
