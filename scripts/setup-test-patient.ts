#!/usr/bin/env bun
/**
 * Create a realistic synthetic KOL (COPD) patient in the COS FHIR sandbox.
 *
 * The patient (Karl Andersson, born 1950-01-01) has:
 *   - COPD diagnosis J44.1
 *   - Spirometry: FEV1 1.8 L / 62 % predicted / FEV1/FVC 0.58 (GOLD 2, Moderate)
 *   - Medications: Spiriva (tiotropium LAMA) + Symbicort (LABA+ICS)
 *   - Former smoker (quit 2019)
 *   - BMI 24.5 kg/m²
 *   - Recent exacerbation (1 x in last 12 months)
 *
 * Usage:
 *   cp .env.example .env  # fill in COS credentials first
 *   bun run setup-patient
 *   bun run setup-patient --dry-run
 */

import { cosClientFromEnv } from "../src/cos-client.js";

const DRY_RUN = process.argv.includes("--dry-run");
const PERSONNUMMER = "195001011234"; // Karl Andersson

// Allow bypassing patient lookup: --patient-id=<fhir-id>
const FORCED_PATIENT_ID = (() => {
  const arg = process.argv.find(a => a.startsWith("--patient-id="));
  return arg ? arg.split("=")[1] : null;
})();

// ISO timestamp helpers
const today = new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

// ─── FHIR resources ───────────────────────────────────────────────────────────

const patientResource = {
  resourceType: "Patient",
  identifier: [
    {
      system: "http://electronichealth.se/identifier/patient",
      value: PERSONNUMMER,
    },
  ],
  name: [{ family: "Andersson", given: ["Karl"] }],
  gender: "male",
  birthDate: "1950-01-01",
  address: [
    {
      line: ["Storgatan 12"],
      city: "Göteborg",
      postalCode: "41101",
      country: "SE",
    },
  ],
};

// Helper: LOINC observation
function makeObs(
  patientRef: string,
  loincCode: string,
  display: string,
  value: number,
  unit: string,
  ucumUnit: string,
  date: string
) {
  return {
    resourceType: "Observation",
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: loincCode,
          display,
        },
      ],
    },
    subject: { reference: `Patient/${patientRef}` },
    effectiveDateTime: `${date}T09:00:00Z`,
    valueQuantity: {
      value,
      unit,
      system: "http://unitsofmeasure.org",
      code: ucumUnit,
    },
  };
}

type PatientEntry = { resource: { id: string; name?: unknown; birthDate?: string; identifier?: unknown } };

async function trySearch(
  cos: ReturnType<typeof cosClientFromEnv>,
  params: Record<string, string>,
  label: string
): Promise<string | null> {
  try {
    const bundle = await cos.fhirGet<{ entry?: Array<PatientEntry> }>("Patient", params);
    const id = bundle.entry?.[0]?.resource?.id;
    if (id) {
      console.log(`  Found existing patient via ${label} (id: ${id})`);
      return id;
    }
    return null;
  } catch (e) {
    console.log(`    [debug] ${label} failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return null;
  }
}

async function listSandboxPatients(cos: ReturnType<typeof cosClientFromEnv>): Promise<void> {
  // Try several search strategies to list available patients
  const attempts: Array<[Record<string, string>, string]> = [
    [{ family: "Andersson" }, "family=Andersson"],
    [{ family: "Test" }, "family=Test"],
    [{ family: "Patient" }, "family=Patient"],
    [{ name: "Karl" }, "name=Karl"],
  ];

  for (const [params, label] of attempts) {
    try {
      const bundle = await cos.fhirGet<{ entry?: Array<PatientEntry> }>("Patient", params);
      if (bundle.entry?.length) {
        console.log(`  Patients found (${label}):`);
        for (const e of bundle.entry) {
          const r = e.resource;
          console.log(`    id=${r.id}  birthDate=${r.birthDate ?? "?"}  name=${JSON.stringify(r.name ?? "?")}`);
        }
        return;
      }
    } catch {
      // try next
    }
  }
  console.log("  Could not list sandbox patients — no supported search parameter found.");
  console.log("  Log into the COS developer portal to find a test patient ID.");
}

async function findOrCreatePatient(cos: ReturnType<typeof cosClientFromEnv>): Promise<string> {
  // Identifier systems recognised by COS for personnummer
  const identifierSearches: Array<[Record<string, string>, string]> = [
    [{ identifier: `urn:oid:1.2.752.129.2.1.3.1|${PERSONNUMMER}` }, "OID identifier"],
    [{ identifier: PERSONNUMMER }, "bare identifier"],
  ];

  for (const [params, label] of identifierSearches) {
    const id = await trySearch(cos, params, label);
    if (id) return id;
  }

  // Try to create
  console.log("  Not found, attempting to create…");
  try {
    const created = await cos.fhirPost<{ id: string }>("Patient", patientResource);
    if (created.id) return created.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Could not create patient: ${msg}`);
    console.log("\n  The COS sandbox appears to be read-only for Patient resources.");
    console.log("  Re-run with --patient-id=<FHIR-id> to attach clinical data to an existing patient.\n");
    console.log("  Searching for available sandbox patients…");
    await listSandboxPatients(cos);
    process.exit(1);
  }

  throw new Error("Could not obtain a patient ID");
}

async function main() {
  console.log("COS Sandbox — Synthetic KOL Patient Setup");
  console.log("==========================================");
  console.log(`Personnummer : ${PERSONNUMMER}`);
  console.log(`Patient name : Karl Andersson`);
  console.log(`Dry run      : ${DRY_RUN}\n`);

  if (DRY_RUN) {
    console.log("[dry-run] Would create the following resources:");
    console.log("  1. Patient (Karl Andersson, 195001011234)");
    console.log("  2. Condition (J44.1 COPD with acute exacerbation)");
    console.log("  3. Observation (FEV1 1.8 L)");
    console.log("  4. Observation (FEV1 % predicted 62 %)");
    console.log("  5. Observation (FVC 3.1 L)");
    console.log("  6. Observation (FEV1/FVC 0.58)");
    console.log("  7. Observation (Smoking status — former smoker)");
    console.log("  8. Observation (BMI 24.5)");
    console.log("  9. MedicationStatement (Spiriva 18 µg — tiotropium LAMA)");
    console.log(" 10. MedicationStatement (Symbicort 160/4.5 µg — budesonide/formoterol ICS+LABA)");
    console.log(" 11. Encounter (Outpatient visit today)");
    process.exit(0);
  }

  const cos = cosClientFromEnv();

  // 1. Find or create patient
  let pid: string;
  if (FORCED_PATIENT_ID) {
    pid = FORCED_PATIENT_ID;
    console.log(`Using forced patient ID: ${pid}\n`);
  } else {
    // COS sandbox often has pre-existing test patients — search first.
    console.log("Looking up Patient…");
    pid = await findOrCreatePatient(cos);
  }
  console.log(`  ✓ Using patient — FHIR ID: ${pid}\n`);

  // COS CapabilityStatement (2025-02-24):
  //   Observation: create ✓  Encounter: create ✓
  //   Condition: search-type only  MedicationStatement: not in API
  //   MedicationRequest: search-type only
  // We create Observations + Encounter; COPD diagnosis must exist in COS already
  // or the agent will note it as missing.
  const spiroDate = monthsAgo(2);

  const entries = [
    // Spirometry (LOINC)
    makeObs(pid, "20150-9", "FEV1 measured", 1.8, "L", "L", spiroDate),
    makeObs(pid, "19926-5", "FEV1 % predicted", 62, "%", "%", spiroDate),
    makeObs(pid, "19868-9", "FVC measured", 3.1, "L", "L", spiroDate),
    makeObs(pid, "40445-0", "FEV1/FVC ratio", 0.58, "ratio", "1", spiroDate),
    // Smoking status (LOINC observation + SNOMED value)
    {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "72166-2", display: "Tobacco smoking status" }] },
      subject: { reference: `Patient/${pid}` },
      effectiveDateTime: `${monthsAgo(6)}T09:00:00Z`,
      valueCodeableConcept: {
        coding: [{ system: "http://snomed.info/sct", code: "8517006", display: "Ex-cigarette smoker" }],
        text: "Former smoker - quit 2019",
      },
    },
    // Vitals
    makeObs(pid, "39156-5", "Body mass index (BMI)", 24.5, "kg/m2", "kg/m2", monthsAgo(3)),
    makeObs(pid, "29463-7", "Body weight", 78, "kg", "kg", monthsAgo(3)),
    makeObs(pid, "8302-2", "Body height", 178, "cm", "cm", monthsAgo(12)),
    // Encounter (today's outpatient COPD follow-up)
    {
      resourceType: "Encounter",
      status: "finished",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
      type: [{
        coding: [{ system: "http://snomed.info/sct", code: "11429006", display: "Consultation" }],
        text: "COPD follow-up visit",
      }],
      subject: { reference: `Patient/${pid}` },
      period: { start: `${today}T08:30:00Z`, end: `${today}T09:00:00Z` },
      reasonCode: [{ coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J44.1" }] }],
    },
  ];

  console.log(`Creating ${entries.length} clinical resources…`);
  let created = 0;
  let failed = 0;
  for (const resource of entries) {
    try {
      if (DRY_RUN) {
        console.log(`  [dry-run] POST ${resource.resourceType}`);
      } else {
        await cos.fhirPost(resource.resourceType, resource);
        console.log(`  ✓ ${resource.resourceType} created`);
        created++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.error(`  ✗ ${resource.resourceType} failed: ${msg}`);
      failed++;
    }
  }
  console.log(`\n  Done: ${created} created, ${failed} failed\n`);

  console.log("═══════════════════════════════════════════════════");
  console.log("✓ Setup complete!");
  console.log(`  FHIR Patient ID : ${pid}`);
  console.log(`\nAdd to .env:`);
  console.log(`  DEFAULT_PERSONNUMMER=${pid}   # use FHIR ID since sandbox personnummer differs`);
  console.log(`\nRun the demo:`);
  console.log(`  bun run agent --room=<your-banterop-room-id> --patient=${pid}`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
