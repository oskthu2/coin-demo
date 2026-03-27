/**
 * Mock FHIR responses for the Vitalis demo.
 *
 * Patient: Emil Andersson, born 1947-06-30, FHIR id=754
 * (real patient in COS sandbox — clinical data added here for demo purposes)
 *
 * Clinical profile:
 *   - COPD J44.1 (GOLD 2, Moderate) — FEV1 58% predicted, FEV1/FVC 0.61
 *   - Former smoker (quit 2018)
 *   - Medications: tiotropium (LAMA) + budesonide/formoterol (ICS+LABA)
 *   - BMI 26.2 kg/m², weight 82 kg, height 177 cm
 *   - 1 exacerbation last 12 months (hospitalisation April 2025)
 */

export const MOCK_PATIENT_ID = "754";
export const MOCK_PERSONNUMMER = "194706302595";

const today = new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

export function getMockResponse(toolName: string, args: Record<string, unknown>): string | null {
  switch (toolName) {
    case "fhir_find_patient":
      return JSON.stringify({
        fhir_patient_id: "754",
        name: "Emil Andersson",
        gender: "male",
        birthDate: "1947-06-30",
        personnummer: MOCK_PERSONNUMMER,
      });

    case "fhir_get_conditions":
      return JSON.stringify({
        conditions: [
          {
            icd10: "J44.1",
            display: "Chronic obstructive pulmonary disease with acute exacerbation",
            onsetDate: monthsAgo(36),
            clinicalStatus: "active",
          },
          {
            icd10: "I10",
            display: "Essential hypertension",
            onsetDate: monthsAgo(60),
            clinicalStatus: "active",
          },
        ],
      });

    case "fhir_get_medications":
      return JSON.stringify({
        medications: [
          {
            atcCode: "R03BB04",
            name: "tiotropium — Spiriva Respimat 2.5 mcg/dose",
            dose: "2 doses (5 mcg) once daily",
          },
          {
            atcCode: "R03AK07",
            name: "formoterol/budesonide — Symbicort Turbuhaler 160/4.5 mcg",
            dose: "1-2 doses twice daily",
          },
          {
            atcCode: "C09AA05",
            name: "ramipril — 5 mg tablet",
            dose: "1 tablet daily",
          },
        ],
      });

    case "fhir_get_spirometry": {
      const spiroDate = monthsAgo(3);
      return JSON.stringify({
        spirometry: {
          fev1_L: 1.62,
          fev1_unit: "L",
          fev1_date: spiroDate,
          fev1_pct_predicted: 58,
          fev1_pct_date: spiroDate,
          fvc_L: 2.66,
          fvc_date: spiroDate,
          fev1_fvc_ratio: 0.61,
          fev1_fvc_date: spiroDate,
          gold_stage: "GOLD 2 (Moderate)",
          note: "Post-bronchodilator values",
        },
      });
    }

    case "fhir_get_vitals":
      return JSON.stringify({
        vitals: {
          bmi: 26.2,
          bmi_date: monthsAgo(3),
          weight_kg: 82,
          height_cm: 177,
        },
      });

    case "fhir_get_smoking_status":
      return JSON.stringify({
        smoking_status: "former smoker",
        recorded_date: monthsAgo(12),
        snomed_code: "8517006",
        note: "Quit smoking 2018 after 35 pack-years",
      });

    case "fhir_get_encounters":
      return JSON.stringify({
        encounters: [
          {
            id: "enc-today",
            date: today,
            status: "finished",
            class: "AMB",
            type: "COPD follow-up outpatient visit",
          },
          {
            id: "enc-exacerbation",
            date: monthsAgo(5),
            status: "finished",
            class: "IMP",
            type: "Hospitalisation — acute COPD exacerbation",
          },
        ],
      });

    default:
      return null;
  }
}
