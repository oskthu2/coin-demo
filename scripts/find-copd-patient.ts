#!/usr/bin/env bun
/**
 * Explore the COS sandbox to find patients with COPD or relevant lung diagnoses.
 *
 * Strategy:
 *   1. Search Condition by ICD-10 J44.x (COPD), J43.x (emphysema), J45.x (asthma)
 *   2. Collect unique patient references from results
 *   3. Fetch each patient + their observations (spirometry) to assess suitability
 *
 * Usage:
 *   bun run scripts/find-copd-patient.ts
 *   bun run scripts/find-copd-patient.ts --codes=J44,J43
 */

import { cosClientFromEnv } from "../src/cos-client.js";
import type { FhirBundle } from "../src/cos-client.js";

const ICD10_CODES = (() => {
  const arg = process.argv.find(a => a.startsWith("--codes="));
  return arg ? arg.split("=")[1].split(",") : ["J44", "J43", "J45"];
})();

const LOINC_SPIROMETRY = ["20150-9", "19926-5", "19868-9", "40445-0"];

const cos = cosClientFromEnv();

async function conditionsForPatient(patientId: string): Promise<Array<{ icd10: string; display: string }>> {
  try {
    const bundle = await cos.fhirGet<FhirBundle>("Condition", {
      subject: `Patient/${patientId}`,
    });
    return (bundle.entry ?? []).map(({ resource: r }) => {
      const cond = r as Record<string, unknown>;
      const coding = ((cond.code as Record<string, unknown>)?.coding as Array<Record<string, unknown>>)?.[0];
      return {
        icd10: coding?.code as string ?? "?",
        display: coding?.display as string ?? "",
      };
    });
  } catch {
    return [];
  }
}

async function patientsFromObservations(loincCode: string): Promise<Set<string>> {
  const patientIds = new Set<string>();
  try {
    const bundle = await cos.fhirGet<FhirBundle>("Observation", {
      code: loincCode,
      status: "final",
    });
    for (const { resource: r } of bundle.entry ?? []) {
      const obs = r as Record<string, unknown>;
      const ref = (obs.subject as Record<string, unknown>)?.reference as string ?? "";
      const id = ref.replace("Patient/", "");
      if (id) patientIds.add(id);
    }
  } catch (e) {
    console.error(`  [warn] Observation search for ${loincCode} failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
  return patientIds;
}

async function fetchPatient(patientRef: string): Promise<Record<string, unknown> | null> {
  try {
    const id = patientRef.replace("Patient/", "");
    const p = await cos.fhirGet<Record<string, unknown>>(`Patient/${id}`, {});
    return p;
  } catch {
    return null;
  }
}

async function fetchSpirometry(patientId: string): Promise<Array<{ code: string; value: number; unit: string; date: string }>> {
  try {
    const bundle = await cos.fhirGet<FhirBundle>("Observation", {
      patient: `Patient/${patientId}`,
      code: LOINC_SPIROMETRY.join(","),
      status: "final",
    });
    return (bundle.entry ?? []).map(({ resource: r }) => {
      const obs = r as Record<string, unknown>;
      const coding = ((obs.code as Record<string, unknown>)?.coding as Array<Record<string, unknown>>)?.find(
        c => (c.system as string)?.includes("loinc")
      );
      const vq = obs.valueQuantity as Record<string, unknown> | undefined;
      return {
        code: coding?.code as string ?? "?",
        value: vq?.value as number ?? 0,
        unit: vq?.unit as string ?? "",
        date: (obs.effectiveDateTime as string)?.slice(0, 10) ?? "",
      };
    }).filter(o => o.value);
  } catch {
    return [];
  }
}

async function printPatient(pid: string) {
  const p = await fetchPatient(`Patient/${pid}`);
  if (!p) { console.log(`  Patient/${pid}: could not fetch`); return; }

  const nameArr = p.name as Array<Record<string, unknown>> | undefined;
  const name0 = nameArr?.[0];
  const name = `${((name0?.given as string[]) ?? []).join(" ")} ${name0?.family ?? ""}`.trim();
  const birth = p.birthDate as string ?? "?";
  const idArr = p.identifier as Array<Record<string, unknown>> | undefined;
  const pnr = idArr?.map(i => i.value as string).find(v => v?.length >= 10) ?? "";

  console.log(`\nPatient ${pid}: ${name} (born ${birth})${pnr ? "  pnr=" + pnr : ""}`);

  const conditions = await conditionsForPatient(pid);
  if (conditions.length > 0) {
    const lung = conditions.filter(c => /^J[34]\d/.test(c.icd10 ?? ""));
    const others = conditions.filter(c => !/^J[34]\d/.test(c.icd10 ?? ""));
    if (lung.length > 0)
      console.log(`  Lung diagnoses: ${lung.map(c => `${c.icd10} (${c.display || "?"})` ).join(", ")}`);
    if (others.length > 0)
      console.log(`  Other diagnoses (${others.length}): ${others.slice(0, 5).map(c => c.icd10).join(", ")}${others.length > 5 ? "…" : ""}`);
  } else {
    console.log(`  Conditions: none found`);
  }

  const spiro = await fetchSpirometry(pid);
  if (spiro.length > 0) {
    const byCode: Record<string, typeof spiro[0]> = {};
    for (const s of spiro) if (!byCode[s.code]) byCode[s.code] = s;
    const fev1pct = byCode["19926-5"]?.value;
    const fev1L   = byCode["20150-9"]?.value;
    const ratio   = byCode["40445-0"]?.value;
    const fvc     = byCode["19868-9"]?.value;
    const gold    = fev1pct !== undefined
      ? fev1pct >= 80 ? "GOLD 1" : fev1pct >= 50 ? "GOLD 2" : fev1pct >= 30 ? "GOLD 3" : "GOLD 4"
      : null;
    console.log(`  Spirometry (${byCode["19926-5"]?.date ?? byCode["20150-9"]?.date ?? "?"}):`
      + (fev1L   ? `  FEV1=${fev1L}L`           : "")
      + (fev1pct ? `  FEV1%pred=${fev1pct}%`     : "")
      + (fvc     ? `  FVC=${fvc}L`               : "")
      + (ratio   ? `  FEV1/FVC=${ratio}`          : "")
      + (gold    ? `  → ${gold}`                  : ""));
  } else {
    console.log(`  Spirometry: none found`);
  }

  console.log(`  ➜  --patient-id=${pid}`);
}

async function main() {
  console.log("COS Sandbox — COPD/Lung Patient Explorer");
  console.log("==========================================\n");

  // Strategy 1: find patients via spirometry observations (no patient filter needed)
  console.log("Searching Observation by spirometry LOINC codes…");
  const spiroLoinc = ["19926-5", "20150-9", "40445-0"]; // FEV1%pred, FEV1, ratio
  const patientIds = new Set<string>();
  for (const code of spiroLoinc) {
    process.stdout.write(`  code=${code}… `);
    const ids = await patientsFromObservations(code);
    console.log(`${ids.size} patient(s)`);
    for (const id of ids) patientIds.add(id);
  }

  if (patientIds.size > 0) {
    console.log(`\nPatients with spirometry data: ${patientIds.size}`);
    for (const pid of patientIds) await printPatient(pid);
    return;
  }

  // Strategy 2: known patient IDs — check their conditions
  console.log("\nNo spirometry found. Checking known patients by ID…");
  const knownIds = ["754"]; // Emil Andersson found earlier
  for (const pid of knownIds) await printPatient(pid);

  // Strategy 3: search by family name
  console.log("\nSearching patients by common family names…");
  const names = ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson"];
  const found = new Set<string>();
  for (const family of names) {
    if (found.size >= 10) break;
    try {
      const bundle = await cos.fhirGet<FhirBundle>("Patient", { family });
      for (const { resource: r } of bundle.entry ?? []) {
        const p = r as Record<string, unknown>;
        if (p.id) found.add(p.id as string);
      }
    } catch { /* skip */ }
  }
  const newIds = [...found].filter(id => !knownIds.includes(id));
  console.log(`Found ${newIds.length} additional patients via family name search`);
  for (const pid of newIds.slice(0, 10)) await printPatient(pid);
}

main().catch(e => { console.error(e); process.exit(1); });

main().catch(e => { console.error(e); process.exit(1); });
