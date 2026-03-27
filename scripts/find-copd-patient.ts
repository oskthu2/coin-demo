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

async function searchConditionsByCode(code: string): Promise<Array<{ patientRef: string; icd10: string; display: string }>> {
  try {
    const bundle = await cos.fhirGet<FhirBundle>("Condition", {
      code: `http://hl7.org/fhir/sid/icd-10|${code}`,
    });
    return (bundle.entry ?? []).map(({ resource: r }) => {
      const cond = r as Record<string, unknown>;
      const subject = (cond.subject as Record<string, unknown>)?.reference as string ?? "";
      const coding = ((cond.code as Record<string, unknown>)?.coding as Array<Record<string, unknown>>)?.[0];
      return {
        patientRef: subject,
        icd10: coding?.code as string ?? code,
        display: coding?.display as string ?? "",
      };
    }).filter(c => c.patientRef);
  } catch (e) {
    console.error(`  [warn] Condition search for ${code} failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return [];
  }
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

async function main() {
  console.log("COS Sandbox — COPD/Lung Patient Explorer");
  console.log("==========================================");
  console.log(`Searching ICD-10 codes: ${ICD10_CODES.join(", ")}\n`);

  // 1. Collect all condition hits
  const condHits: Array<{ patientRef: string; icd10: string; display: string }> = [];
  for (const code of ICD10_CODES) {
    process.stdout.write(`Searching Condition?code=J${code.replace(/^J/, "")}… `);
    const hits = await searchConditionsByCode(code);
    console.log(`${hits.length} hits`);
    condHits.push(...hits);
  }

  // 2. Deduplicate patient references
  const seen = new Set<string>();
  const unique = condHits.filter(h => {
    if (seen.has(h.patientRef)) return false;
    seen.add(h.patientRef);
    return true;
  });

  console.log(`\nUnique patients with matching diagnoses: ${unique.length}\n`);

  if (unique.length === 0) {
    console.log("No patients found. Try --codes=J44 or check your credentials.");
    return;
  }

  // 3. For each patient, fetch demographics + spirometry
  for (const { patientRef, icd10, display } of unique) {
    const pid = patientRef.replace("Patient/", "");
    const p = await fetchPatient(patientRef);
    if (!p) {
      console.log(`  ${patientRef}: could not fetch`);
      continue;
    }

    const nameArr = p.name as Array<Record<string, unknown>> | undefined;
    const name0 = nameArr?.[0];
    const name = `${((name0?.given as string[]) ?? []).join(" ")} ${name0?.family ?? ""}`.trim();
    const birth = p.birthDate as string ?? "?";
    const idArr = p.identifier as Array<Record<string, unknown>> | undefined;
    const pnr = idArr?.map(i => i.value as string).find(v => v?.length >= 10) ?? "";

    console.log(`Patient ${pid}: ${name} (born ${birth})${pnr ? "  pnr=" + pnr : ""}`);
    console.log(`  Diagnosis: ${icd10} — ${display}`);

    const spiro = await fetchSpirometry(pid);
    if (spiro.length > 0) {
      const byCode: Record<string, typeof spiro[0]> = {};
      for (const s of spiro) if (!byCode[s.code]) byCode[s.code] = s;

      const fev1pct = byCode["19926-5"]?.value;
      const fev1L = byCode["20150-9"]?.value;
      const ratio = byCode["40445-0"]?.value;
      const fvc = byCode["19868-9"]?.value;

      const gold = fev1pct !== undefined
        ? fev1pct >= 80 ? "GOLD 1" : fev1pct >= 50 ? "GOLD 2" : fev1pct >= 30 ? "GOLD 3" : "GOLD 4"
        : null;

      console.log(`  Spirometry (${byCode["19926-5"]?.date ?? byCode["20150-9"]?.date ?? "?"}):` +
        (fev1L ? `  FEV1=${fev1L}L` : "") +
        (fev1pct ? `  FEV1%pred=${fev1pct}%` : "") +
        (fvc ? `  FVC=${fvc}L` : "") +
        (ratio ? `  FEV1/FVC=${ratio}` : "") +
        (gold ? `  → ${gold}` : ""));
    } else {
      console.log(`  Spirometry: none found`);
    }

    console.log(`\n  ➜  bun run scripts/setup-test-patient.ts --patient-id=${pid}`);
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
