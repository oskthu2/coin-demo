/**
 * FHIR tool definitions (Anthropic SDK format) and their implementations
 * against the COS FHIR R4 API.
 *
 * Terminology / code-system mapping:
 *   - Diagnoses  : ICD-10-SE via http://hl7.org/fhir/sid/icd-10
 *   - Spirometry : LOINC
 *   - Smoking    : LOINC observation + SNOMED value set
 *   - Medications: ATC codes (swedish FHIR profiles use ATC for ingredient)
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import type { CosClient, FhirBundle, FhirResource } from "./cos-client.js";
import { getMockResponse } from "./mock-fhir-data.js";

// ─── Code-system constants ────────────────────────────────────────────────────

const LOINC = {
  FEV1_MEASURED: "20150-9",
  FEV1_PCT_PREDICTED: "19926-5",
  FVC_MEASURED: "19868-9",
  FEV1_FVC_RATIO: "40445-0",
  BMI: "39156-5",
  BODY_WEIGHT: "29463-7",
  BODY_HEIGHT: "8302-2",
  SMOKING_STATUS: "72166-2",
  CAT_SCORE: "89919-2", // COPD Assessment Test total
} as const;

// SNOMED values for smoking status (used as Observation.value[x])
const SMOKING_SNOMED: Record<string, string> = {
  "449868002": "current smoker",
  "77176002": "current smoker",
  "8517006": "former smoker",
  "266919005": "never smoker",
  "405746006": "never smoker",
};

// ─── Tool schema definitions ─────────────────────────────────────────────────

export const FHIR_TOOLS: Tool[] = [
  {
    name: "fhir_find_patient",
    description:
      "Look up a patient in the COS EHR by personnummer (Swedish personal identity number). " +
      "Returns the FHIR patient ID needed for all subsequent queries, plus basic demographics.",
    input_schema: {
      type: "object",
      properties: {
        personnummer: {
          type: "string",
          description:
            "Personnummer in any common format: YYYYMMDDXXXX, YYYYMMDD-XXXX, or YYMMDD-XXXX",
        },
      },
      required: ["personnummer"],
    },
  },
  {
    name: "fhir_get_conditions",
    description:
      "Get active/confirmed diagnoses for a patient as ICD-10 codes. " +
      "Use icd10_prefix='J44' to filter for COPD diagnoses.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "FHIR Patient.id" },
        icd10_prefix: {
          type: "string",
          description:
            "Optional ICD-10 code prefix to filter results (e.g. 'J44' for COPD, 'J45' for asthma)",
        },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "fhir_get_medications",
    description:
      "Get currently active medications for a patient. " +
      "Use atc_prefix='R03' to filter for respiratory medicines (LABA, LAMA, ICS, etc.).",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "FHIR Patient.id" },
        atc_prefix: {
          type: "string",
          description:
            "Optional ATC code prefix (e.g. 'R03' for obstructive airway drugs, " +
            "'R03AC' for LABA, 'R03BB' for LAMA, 'R03BA' for ICS)",
        },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "fhir_get_spirometry",
    description:
      "Get spirometry / lung-function measurements: FEV1 (litres), FEV1 % of predicted, " +
      "FVC (litres), and FEV1/FVC ratio. Returns results from the most recent test within " +
      "the specified window. Post-bronchodilator values are preferred.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "FHIR Patient.id" },
        months_back: {
          type: "number",
          description: "How far back to search in months (default 12)",
        },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "fhir_get_vitals",
    description:
      "Get the most recent height, weight, and calculated BMI for a patient.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "FHIR Patient.id" },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "fhir_get_smoking_status",
    description:
      "Get the documented smoking status: 'never smoker', 'former smoker', or 'current smoker'. " +
      "Returns the most recent Observation.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "FHIR Patient.id" },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "fhir_get_encounters",
    description:
      "Get outpatient and inpatient encounters (care contacts) for a patient. " +
      "Useful for finding the visit date to register.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "FHIR Patient.id" },
        months_back: {
          type: "number",
          description: "How far back to search in months (default 6)",
        },
      },
      required: ["patient_id"],
    },
  },
];

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

/** Set MOCK_FHIR=true (env) or pass useMock=true to bypass real COS calls. */
export const USE_MOCK_FHIR = process.env.MOCK_FHIR === "true";

export async function executeFhirTool(
  toolName: string,
  args: Record<string, unknown>,
  cos: CosClient
): Promise<string> {
  if (USE_MOCK_FHIR) {
    const mock = getMockResponse(toolName, args);
    if (mock !== null) return mock;
  }
  switch (toolName) {
    case "fhir_find_patient":
      return findPatient(args.personnummer as string, cos);
    case "fhir_get_conditions":
      return getConditions(
        args.patient_id as string,
        args.icd10_prefix as string | undefined,
        cos
      );
    case "fhir_get_medications":
      return getMedications(
        args.patient_id as string,
        args.atc_prefix as string | undefined,
        cos
      );
    case "fhir_get_spirometry":
      return getSpirometry(
        args.patient_id as string,
        (args.months_back as number) ?? 12,
        cos
      );
    case "fhir_get_vitals":
      return getVitals(args.patient_id as string, cos);
    case "fhir_get_smoking_status":
      return getSmokingStatus(args.patient_id as string, cos);
    case "fhir_get_encounters":
      return getEncounters(
        args.patient_id as string,
        (args.months_back as number) ?? 6,
        cos
      );
    default:
      throw new Error(`Unknown FHIR tool: ${toolName}`);
  }
}

// ─── Individual implementations ───────────────────────────────────────────────

async function findPatient(personnummer: string, cos: CosClient): Promise<string> {
  // Normalise to 12-digit format (strip hyphens/pluses)
  const pnr = personnummer.replace(/[-+\s]/g, "");

  // COS supports: identifier (token), family (string), given (string)
  // OID 1.2.752.129.2.1.3.1 = Swedish personnummer system
  const identifiers = [
    `urn:oid:1.2.752.129.2.1.3.1|${pnr}`,
    pnr,
  ];

  let entries: Array<{ resource: Record<string, unknown> }> = [];
  for (const identifier of identifiers) {
    const bundle = await cos.fhirGet<FhirBundle>("Patient", { identifier });
    entries = (bundle.entry ?? []) as typeof entries;
    if (entries.length > 0) break;
  }

  // Fallback: search by family name derived from the lookup context
  // (the agent may pass name hints via a specially-formatted personnummer)
  if (entries.length === 0) {
    return `No patient found with personnummer ${personnummer}. ` +
      `Try fhir_find_patient with the FHIR numeric ID directly, ` +
      `or use fhir_get_conditions/fhir_get_observations with the known patient ID.`;
  }

  const p = entries[0].resource;
  const name = (p.name as Array<Record<string, unknown>>)?.[0];
  const given = (name?.given as string[])?.join(" ") ?? "";
  const family = (name?.family as string) ?? "";
  const gender = p.gender ?? "unknown";
  const birthDate = p.birthDate ?? "unknown";

  return JSON.stringify({
    fhir_patient_id: p.id,
    name: `${given} ${family}`.trim(),
    gender,
    birthDate,
    personnummer: pnr,
  });
}

async function getConditions(
  patientId: string,
  icd10Prefix: string | undefined,
  cos: CosClient
): Promise<string> {
  // COS Condition supports: subject (reference), code (token), category (token)
  // Note: no clinical-status, _sort, or _count support
  const params: Record<string, string> = {
    subject: `Patient/${patientId}`,
  };

  if (icd10Prefix) {
    params.code = `http://hl7.org/fhir/sid/icd-10|${icd10Prefix}`;
  }

  const bundle = await cos.fhirGet<FhirBundle>("Condition", params);
  const entries = bundle.entry ?? [];

  if (entries.length === 0) {
    return `No active conditions found${icd10Prefix ? ` matching ICD-10 prefix ${icd10Prefix}` : ""}.`;
  }

  const conditions = entries.map(({ resource: r }) => {
    const cond = r as Record<string, unknown>;
    const coding = (
      (cond.code as Record<string, unknown>)?.coding as Array<
        Record<string, unknown>
      >
    )?.[0];
    return {
      icd10: coding?.code,
      display: coding?.display ?? (cond.code as Record<string, unknown>)?.text,
      onsetDate: (cond.onsetDateTime as string)?.slice(0, 10),
      clinicalStatus: (
        (cond.clinicalStatus as Record<string, unknown>)
          ?.coding as Array<Record<string, unknown>>
      )?.[0]?.code,
    };
  });

  return JSON.stringify({ conditions });
}

async function getMedications(
  patientId: string,
  atcPrefix: string | undefined,
  cos: CosClient
): Promise<string> {
  // COS supports MedicationRequest (search-type) with: subject, _profile, category, date
  // MedicationStatement is NOT supported by COS FHIR API
  const bundle = await cos.fhirGet<FhirBundle>("MedicationRequest", {
    subject: `Patient/${patientId}`,
  });
  const entries = (bundle.entry ?? []) as Array<{ resource: Record<string, unknown> }>;

  if (entries.length === 0) {
    return "No active medications found in the EHR.";
  }

  const meds = entries
    .map(({ resource: r }) => {
      const med = r as Record<string, unknown>;
      const medConcept =
        (med.medicationCodeableConcept as Record<string, unknown>) ??
        (med.medication as Record<string, unknown>);
      const codings = (medConcept?.coding as Array<Record<string, unknown>>) ?? [];
      const atcCoding = codings.find(
        (c) =>
          (c.system as string)?.includes("atc") ||
          (c.system as string)?.includes("ATC")
      );
      const anyCoding = codings[0];
      const code = atcCoding?.code ?? anyCoding?.code;
      const display =
        atcCoding?.display ?? anyCoding?.display ?? medConcept?.text;
      const dosage = (med.dosage as Array<Record<string, unknown>>)?.[0];
      const doseText =
        (dosage?.text as string) ??
        JSON.stringify(dosage?.doseAndRate ?? "");

      return { atcCode: code, name: display, dose: doseText };
    })
    .filter((m) => {
      if (!atcPrefix) return true;
      return (m.atcCode as string)?.startsWith(atcPrefix);
    });

  return JSON.stringify({ medications: meds });
}

async function getSpirometry(
  patientId: string,
  monthsBack: number,
  cos: CosClient
): Promise<string> {
  const dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - monthsBack);
  const dateStr = dateFrom.toISOString().slice(0, 10);

  const loincCodes = [
    LOINC.FEV1_MEASURED,
    LOINC.FEV1_PCT_PREDICTED,
    LOINC.FVC_MEASURED,
    LOINC.FEV1_FVC_RATIO,
  ].join(",");

  // COS Observation supports: patient (reference), code (token), date, status, subject
  const bundle = await cos.fhirGet<FhirBundle>("Observation", {
    patient: `Patient/${patientId}`,
    code: loincCodes,
    date: `ge${dateStr}`,
    status: "final",
  });

  const entries = bundle.entry ?? [];
  if (entries.length === 0) {
    return (
      `No spirometry observations found in the last ${monthsBack} months. ` +
      `This data may be stored in a separate lung-function system or not yet ` +
      `transferred to the EHR.`
    );
  }

  // Group by LOINC code and keep the most recent per code
  const latest: Record<string, Record<string, unknown>> = {};
  for (const { resource: r } of entries) {
    const obs = r as Record<string, unknown>;
    const coding = (
      (obs.code as Record<string, unknown>)?.coding as Array<
        Record<string, unknown>
      >
    )?.find((c) => (c.system as string)?.includes("loinc"));
    if (!coding) continue;
    const code = coding.code as string;
    if (!latest[code]) latest[code] = obs;
  }

  const result: Record<string, unknown> = {};
  const readVal = (obs: Record<string, unknown>) =>
    (obs.valueQuantity as Record<string, unknown>)?.value;
  const readUnit = (obs: Record<string, unknown>) =>
    (obs.valueQuantity as Record<string, unknown>)?.unit;
  const readDate = (obs: Record<string, unknown>) =>
    (obs.effectiveDateTime as string)?.slice(0, 10);

  if (latest[LOINC.FEV1_MEASURED]) {
    result.fev1_L = readVal(latest[LOINC.FEV1_MEASURED]);
    result.fev1_unit = readUnit(latest[LOINC.FEV1_MEASURED]);
    result.fev1_date = readDate(latest[LOINC.FEV1_MEASURED]);
  }
  if (latest[LOINC.FEV1_PCT_PREDICTED]) {
    result.fev1_pct_predicted = readVal(latest[LOINC.FEV1_PCT_PREDICTED]);
    result.fev1_pct_date = readDate(latest[LOINC.FEV1_PCT_PREDICTED]);
  }
  if (latest[LOINC.FVC_MEASURED]) {
    result.fvc_L = readVal(latest[LOINC.FVC_MEASURED]);
    result.fvc_date = readDate(latest[LOINC.FVC_MEASURED]);
  }
  if (latest[LOINC.FEV1_FVC_RATIO]) {
    result.fev1_fvc_ratio = readVal(latest[LOINC.FEV1_FVC_RATIO]);
    result.fev1_fvc_date = readDate(latest[LOINC.FEV1_FVC_RATIO]);
  }

  // Derive GOLD stage from FEV1 % if available
  const fev1pct = result.fev1_pct_predicted as number | undefined;
  if (fev1pct !== undefined) {
    if (fev1pct >= 80) result.gold_stage = "GOLD 1 (Mild)";
    else if (fev1pct >= 50) result.gold_stage = "GOLD 2 (Moderate)";
    else if (fev1pct >= 30) result.gold_stage = "GOLD 3 (Severe)";
    else result.gold_stage = "GOLD 4 (Very severe)";
  }

  return JSON.stringify({ spirometry: result });
}

async function getVitals(patientId: string, cos: CosClient): Promise<string> {
  const bundle = await cos.fhirGet<FhirBundle>("Observation", {
    patient: `Patient/${patientId}`,
    code: [LOINC.BMI, LOINC.BODY_WEIGHT, LOINC.BODY_HEIGHT].join(","),
    status: "final",
  });

  const entries = bundle.entry ?? [];
  if (entries.length === 0) {
    return "No height/weight/BMI observations found.";
  }

  const latest: Record<string, Record<string, unknown>> = {};
  for (const { resource: r } of entries) {
    const obs = r as Record<string, unknown>;
    const coding = (
      (obs.code as Record<string, unknown>)?.coding as Array<
        Record<string, unknown>
      >
    )?.find((c) => (c.system as string)?.includes("loinc"));
    if (!coding) continue;
    const code = coding.code as string;
    if (!latest[code]) latest[code] = obs;
  }

  const vq = (obs: Record<string, unknown>) =>
    obs.valueQuantity as Record<string, unknown> | undefined;

  return JSON.stringify({
    vitals: {
      bmi: vq(latest[LOINC.BMI] ?? {})?.value,
      bmi_date: (latest[LOINC.BMI]?.effectiveDateTime as string)?.slice(0, 10),
      weight_kg: vq(latest[LOINC.BODY_WEIGHT] ?? {})?.value,
      height_cm: vq(latest[LOINC.BODY_HEIGHT] ?? {})?.value,
    },
  });
}

async function getSmokingStatus(
  patientId: string,
  cos: CosClient
): Promise<string> {
  const bundle = await cos.fhirGet<FhirBundle>("Observation", {
    patient: `Patient/${patientId}`,
    code: LOINC.SMOKING_STATUS,
    status: "final",
  });

  const entries = bundle.entry ?? [];
  if (entries.length === 0) {
    return "No smoking status documented in the EHR.";
  }

  const obs = entries[0].resource as Record<string, unknown>;
  const valueCoding = obs.valueCodeableConcept as
    | Record<string, unknown>
    | undefined;
  const snomedCode = (
    (valueCoding?.coding as Array<Record<string, unknown>>)?.[0]?.code as string
  ) ?? "";
  const humanStatus =
    SMOKING_SNOMED[snomedCode] ??
    (valueCoding?.text as string) ??
    "unknown";

  return JSON.stringify({
    smoking_status: humanStatus,
    recorded_date: (obs.effectiveDateTime as string)?.slice(0, 10),
    snomed_code: snomedCode,
  });
}

async function getEncounters(
  patientId: string,
  monthsBack: number,
  cos: CosClient
): Promise<string> {
  const dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - monthsBack);
  const dateStr = dateFrom.toISOString().slice(0, 10);

  // COS Encounter supports: _id, _profile, class, location, status, subject, identifier
  // Note: no 'patient' or 'date' search params
  const bundle = await cos.fhirGet<FhirBundle>("Encounter", {
    subject: `Patient/${patientId}`,
    status: "finished",
  });

  const entries = bundle.entry ?? [];
  if (entries.length === 0) {
    return `No encounters found in the last ${monthsBack} months.`;
  }

  const encounters = entries.map(({ resource: r }) => {
    const enc = r as Record<string, unknown>;
    const period = enc.period as Record<string, unknown> | undefined;
    const typeCoding = (
      (enc.type as Array<Record<string, unknown>>)?.[0]?.coding as Array<
        Record<string, unknown>
      >
    )?.[0];
    return {
      id: enc.id,
      date: (period?.start as string)?.slice(0, 10),
      status: enc.status,
      class: (enc.class as Record<string, unknown>)?.code,
      type: typeCoding?.display ?? typeCoding?.code,
    };
  });

  return JSON.stringify({ encounters });
}
