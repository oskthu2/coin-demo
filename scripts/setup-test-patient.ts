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

async function findOrCreatePatient(cos: ReturnType<typeof cosClientFromEnv>): Promise<string> {
  // Try several identifier systems used for Swedish personnummer
  const systems = [
    `http://electronichealth.se/identifier/patient|${PERSONNUMMER}`,
    `urn:oid:1.2.752.129.2.1.3.1|${PERSONNUMMER}`,
    PERSONNUMMER,
  ];

  for (const identifier of systems) {
    try {
      const bundle = await cos.fhirGet<{ entry?: Array<{ resource: { id: string } }> }>(
        "Patient",
        { identifier }
      );
      const id = bundle.entry?.[0]?.resource?.id;
      if (id) {
        console.log(`  Found existing patient (identifier: ${identifier})`);
        return id;
      }
    } catch {
      // try next system
    }
  }

  // Not found — try to create
  console.log("  Not found, attempting to create…");
  try {
    const created = await cos.fhirPost<{ id: string }>("Patient", patientResource);
    if (created.id) return created.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If sandbox rejects creation, list available patients so user can pick one
    console.error(`  Could not create patient: ${msg}`);
    console.log("\n  Listing available patients in sandbox…");
    try {
      const all = await cos.fhirGet<{ entry?: Array<{ resource: { id: string; name?: unknown; birthDate?: string; identifier?: unknown } }> }>(
        "Patient",
        { _count: "10" }
      );
      if (all.entry?.length) {
        console.log("  Available patients:");
        for (const e of all.entry) {
          const r = e.resource;
          console.log(`    id=${r.id}  birthDate=${r.birthDate ?? "?"}  name=${JSON.stringify(r.name ?? "?")}`);
        }
        console.log("\n  Pick one and set DEFAULT_PERSONNUMMER or pass --patient=<id> when running the agent.");
        console.log("  Then re-run this script with --patient-id=<id> to attach clinical data to an existing patient.");
      } else {
        console.log("  No patients found. Check your COS_API_KEY and COS credentials.");
      }
    } catch (listErr) {
      console.error("  Could not list patients:", listErr);
    }
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
  // COS sandbox often has pre-existing test patients — search first.
  console.log("Looking up Patient…");
  const pid = await findOrCreatePatient(cos);
  console.log(`  ✓ Using patient — FHIR ID: ${pid}\n`);

  // 2. COPD diagnosis
  console.log("Creating Condition (J44.1)…");
  await cos.fhirPost("Condition", {
    resourceType: "Condition",
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }],
    },
    code: {
      coding: [
        {
          system: "http://hl7.org/fhir/sid/icd-10",
          code: "J44.1",
          display: "Kroniskt obstruktiv lungsjukdom med akut exacerbation, ospecificerad",
        },
      ],
    },
    subject: { reference: `Patient/${pid}` },
    onsetDateTime: monthsAgo(18),
  });
  console.log("  ✓ Condition created\n");

  // 3-6. Spirometry
  const spiroDate = monthsAgo(2); // 2 months ago — within the 12-month window
  console.log(`Creating spirometry observations (date: ${spiroDate})…`);
  await cos.fhirPost("Observation", makeObs(pid, "20150-9", "FEV1 measured", 1.8, "L", "L", spiroDate));
  await cos.fhirPost("Observation", makeObs(pid, "19926-5", "FEV1 % predicted", 62, "%", "%", spiroDate));
  await cos.fhirPost("Observation", makeObs(pid, "19868-9", "FVC measured", 3.1, "L", "L", spiroDate));
  await cos.fhirPost("Observation", makeObs(pid, "40445-0", "FEV1/FVC ratio", 0.58, "ratio", "1", spiroDate));
  console.log("  ✓ Spirometry observations created\n");

  // 7. Smoking status — former smoker (SNOMED 8517006)
  console.log("Creating smoking status observation…");
  await cos.fhirPost("Observation", {
    resourceType: "Observation",
    status: "final",
    code: {
      coding: [{ system: "http://loinc.org", code: "72166-2", display: "Tobacco smoking status" }],
    },
    subject: { reference: `Patient/${pid}` },
    effectiveDateTime: `${monthsAgo(6)}T09:00:00Z`,
    valueCodeableConcept: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "8517006",
          display: "Ex-cigarette smoker",
        },
      ],
      text: "Former smoker — quit 2019",
    },
  });
  console.log("  ✓ Smoking status created\n");

  // 8. BMI
  console.log("Creating vitals (BMI)…");
  await cos.fhirPost("Observation", makeObs(pid, "39156-5", "Body mass index (BMI)", 24.5, "kg/m2", "kg/m2", monthsAgo(3)));
  await cos.fhirPost("Observation", makeObs(pid, "29463-7", "Body weight", 78, "kg", "kg", monthsAgo(3)));
  await cos.fhirPost("Observation", makeObs(pid, "8302-2", "Body height", 178, "cm", "cm", monthsAgo(12)));
  console.log("  ✓ Vitals created\n");

  // 9-10. Medications
  console.log("Creating medication statements…");
  await cos.fhirPost("MedicationStatement", {
    resourceType: "MedicationStatement",
    status: "active",
    medicationCodeableConcept: {
      coding: [
        {
          system: "http://www.whocc.no/atc",
          code: "R03BB04",
          display: "tiotropium",
        },
      ],
      text: "Spiriva Respimat 2.5 µg/dos inhalationslösning",
    },
    subject: { reference: `Patient/${pid}` },
    effectiveDateTime: monthsAgo(24),
    dosage: [{ text: "2 doser (5 µg) en gång dagligen" }],
  });

  await cos.fhirPost("MedicationStatement", {
    resourceType: "MedicationStatement",
    status: "active",
    medicationCodeableConcept: {
      coding: [
        {
          system: "http://www.whocc.no/atc",
          code: "R03AK07",
          display: "formoterol and budesonide",
        },
      ],
      text: "Symbicort Turbuhaler 160/4.5 µg/dos inhalationspulver",
    },
    subject: { reference: `Patient/${pid}` },
    effectiveDateTime: monthsAgo(12),
    dosage: [{ text: "1-2 doser 2 gånger dagligen" }],
  });
  console.log("  ✓ Medications created\n");

  // 11. Encounter (today's visit — the one being registered)
  console.log("Creating encounter (today's outpatient visit)…");
  await cos.fhirPost("Encounter", {
    resourceType: "Encounter",
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    type: [
      {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "11429006",
            display: "Consultation",
          },
        ],
        text: "KOL uppföljningsbesök",
      },
    ],
    subject: { reference: `Patient/${pid}` },
    period: { start: `${today}T08:30:00Z`, end: `${today}T09:00:00Z` },
    reasonCode: [
      {
        coding: [
          { system: "http://hl7.org/fhir/sid/icd-10", code: "J44.1" },
        ],
      },
    ],
  });
  console.log("  ✓ Encounter created\n");

  console.log("═══════════════════════════════════════════════════");
  console.log("✓ Test patient setup complete!");
  console.log(`  FHIR Patient ID : ${pid}`);
  console.log(`  Personnummer    : ${PERSONNUMMER}`);
  console.log(`\nAdd to .env:`);
  console.log(`  DEFAULT_PERSONNUMMER=${PERSONNUMMER}`);
  console.log(`\nRun the demo:`);
  console.log(`  bun run agent --room=<your-banterop-room-id> --patient=${PERSONNUMMER}`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
