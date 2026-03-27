#!/usr/bin/env bun
/**
 * Upload the LVR scenario JSON to a banterop instance.
 *
 * Usage:
 *   bun run upload-scenario
 *   bun run upload-scenario --banterop=http://localhost:3000
 *   bun run upload-scenario --dry-run
 */

import { readFileSync } from "fs";
import { join } from "path";

const BANTEROP_URL =
  process.argv.find((a) => a.startsWith("--banterop="))?.split("=")[1] ??
  process.env["BANTEROP_URL"] ??
  "https://banterop.fhir.me";

const DRY_RUN = process.argv.includes("--dry-run");

const scenarioPath = join(import.meta.dir, "..", "scenarios", "lvr-kol-registration.json");
const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));
const scenarioId = scenario.metadata.id as string;

console.log(`Banterop URL : ${BANTEROP_URL}`);
console.log(`Scenario ID  : ${scenarioId}`);
console.log(`Dry run      : ${DRY_RUN}`);

if (DRY_RUN) {
  console.log("\n[dry-run] Scenario JSON validated OK. Would POST to:");
  console.log(`  ${BANTEROP_URL}/api/scenarios`);
  console.log("\nScenario title:", scenario.metadata.title);
  process.exit(0);
}

const editToken = process.env["BANTEROP_EDIT_TOKEN"];
const headers: Record<string, string> = {
  "Content-Type": "application/json",
};
if (editToken) {
  headers["X-Edit-Token"] = editToken;
}

// Try PUT first (update if exists), then POST (create new)
const putRes = await fetch(`${BANTEROP_URL}/api/scenarios/${scenarioId}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ config: scenario }),
});

if (putRes.ok) {
  console.log(`\n✓ Scenario updated: ${scenarioId}`);
} else if (putRes.status === 404) {
  // Scenario doesn't exist yet, create it
  const postRes = await fetch(`${BANTEROP_URL}/api/scenarios`, {
    method: "POST",
    headers,
    body: JSON.stringify({ config: scenario }),
  });

  if (!postRes.ok) {
    const text = await postRes.text();
    console.error(`\n✗ POST failed (${postRes.status}): ${text}`);
    process.exit(1);
  }
  console.log(`\n✓ Scenario created: ${scenarioId}`);
} else {
  const text = await putRes.text();
  console.error(`\n✗ PUT failed (${putRes.status}): ${text}`);
  process.exit(1);
}

console.log(`\nOpen in browser: ${BANTEROP_URL}/scenarios/${scenarioId}`);
console.log(
  `\nNext step: Create a room and load this scenario, then copy the room ID to .env as BANTEROP_ROOM_ID`
);
