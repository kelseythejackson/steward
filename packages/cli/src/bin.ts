#!/usr/bin/env node
import { PACKAGE_NAME } from "./index.js";

const commands = [
  ["scan", "Steward Setup: scan a React + Tailwind repo and build the system model"],
  ["review", "Steward Review: check code against the system model"],
  ["context", "Steward Brief: write design.md and start the MCP server"],
  ["check", "Run Review locally on the working tree"],
] as const;

console.log(`Steward (${PACKAGE_NAME}): nothing to do yet.\n`);
console.log("Planned commands:");
for (const [name, help] of commands) {
  console.log(`  ${name.padEnd(10)} ${help}`);
}
