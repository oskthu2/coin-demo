# Conversational Interop Demo — Vitalis 2025

**COSMIC/COS ↔ Luftvägsregistret (LVR)**

A live demo of Language-First Interoperability between a Swedish EHR system and a quality registry — no pre-coordinated API integration required. Guided by the [banterop](https://github.com/jmandel/banterop) architecture.

---

## What this demo shows

Two AI agents negotiate a quality registry submission in real-time conversation:

```
┌─────────────────────────────────┐       MCP        ┌──────────────────────────────────┐
│  APPLICANT AGENT (our code)     │ ◄──────────────► │  ADMINISTRATOR AGENT (banterop)  │
│                                 │  banterop room   │                                  │
│  Claude claude-opus-4-6                    │                │  LVR scenario (in browser)       │
│  + FHIR tools → COS sandbox     │                │  Knows variable definitions,     │
│  + banterop MCP client          │                │  validation rules, GOLD staging   │
└───────────────┬─────────────────┘                └──────────────────────────────────┘
                │
                ▼
     COS FHIR R4 API (sandbox)
     Real patient data: diagnoses,
     spirometry, medications, vitals,
     smoking status
```

**Scenario:** An applicant agent representing a COSMIC/COS EHR registers a COPD (KOL) patient's outpatient visit with Luftvägsregistret. The LVR administrator agent guides the submission, requests missing data conversationally, and completes (or flags) the registration.

**Why Luftvägsregistret?**
- 100+ structured variables with publicly documented definitions
- Has a working demo environment (lvr.demo.registercentrum.se)
- 93 % of data comes via direct journal-system integrations — NOT via NKRR
- Perfect illustration of the interoperability gap NKRR was meant to solve

---

## Architecture

| Component | Technology |
|-----------|-----------|
| Applicant agent | TypeScript + Bun, `@anthropic-ai/sdk` (Claude claude-opus-4-6) |
| FHIR client | COS FHIR R4 API, OAuth2 client credentials |
| MCP transport | `@modelcontextprotocol/sdk` Streamable HTTP → banterop |
| Administrator agent | banterop scenario (runs in browser) |
| Scenario format | Banterop `ScenarioConfiguration` JSON |

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- COS sandbox credentials from [developer.openservices.cambio.se](https://developer.openservices.cambio.se)
- Anthropic API key
- Access to [banterop.fhir.me](https://banterop.fhir.me) (or run banterop locally)

---

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in:
#   COS_FHIR_BASE_URL, COS_TOKEN_URL, COS_CLIENT_ID, COS_CLIENT_SECRET
#   ANTHROPIC_API_KEY
#   BANTEROP_URL (default: https://banterop.fhir.me)
```

### 3. Create a synthetic test patient in COS

```bash
bun run setup-patient --dry-run   # preview what will be created
bun run setup-patient             # create in COS sandbox
```

This creates **Karl Andersson** (personnummer `195001011234`) with:
- Diagnosis J44.1 (COPD with exacerbation)
- Spirometry: FEV1 62 % predicted, FEV1/FVC 0.58 → GOLD 2 (Moderate)
- Medications: Spiriva (LAMA) + Symbicort (LABA+ICS)
- Former smoker (quit 2019), BMI 24.5

### 4. Upload the LVR scenario to banterop

```bash
bun run upload-scenario --dry-run    # validate scenario JSON
bun run upload-scenario              # upload to banterop
```

The scenario (`scenarios/lvr-kol-registration.json`) defines the LVR administrator agent: its knowledge of mandatory/optional variables, GOLD staging, ATC medication categories, validation rules, and conversational goals.

### 5. Create a banterop room

1. Open [banterop.fhir.me](https://banterop.fhir.me) in a browser
2. Go to **Scenarios** → find `lvr-kol-outpatient-v1`
3. Click **Create room** — this generates a room ID (e.g. `abc-123-xyz`)
4. Add to `.env`: `BANTEROP_ROOM_ID=abc-123-xyz`

---

## Running the demo

Open **two screens** side by side:

**Screen 1 — LVR administrator (banterop browser)**
```
https://banterop.fhir.me/rooms/<your-room-id>
```
The LVR agent's thinking and tool calls are visible here in real-time.

**Screen 2 — Applicant agent (terminal)**
```bash
bun run agent
# or explicitly:
bun run agent --room=abc-123-xyz --patient=195001011234
```

Watch the agents negotiate. The terminal shows FHIR queries to COS in blue, LVR messages in green.

---

## Demo narrative (Vitalis script)

1. **Setup** (~1 min): "We have a patient with COPD. The region's EHR has their data in COS. The quality registry needs a specific set of variables. Normally this would require a custom integration. Today we'll do it with conversation."

2. **Agent starts** (~30 s): Applicant agent finds the patient, opens chat with LVR admin.

3. **LVR requests data** (~1 min): LVR admin lists what it needs. Audience sees the structured knowledge base in action.

4. **FHIR queries** (~1 min): Applicant queries spirometry, medications, smoking status. Audience sees real FHIR API calls.

5. **CAT score gap** (~30 s): LVR asks for CAT score. Applicant reports it's not in the EHR. LVR accepts with a flag — *this is the interesting moment*: conversational negotiation of what's available vs required.

6. **Registration complete**: LVR submits. Shows completeness summary with flags.

7. **Discussion**: "This is what NKRR should enable — but most registers aren't there yet. This demo shows what's possible today, today."

---

## Project structure

```
coin-demo/
├── src/
│   ├── cos-client.ts          # OAuth2 + FHIR R4 client for COS
│   ├── fhir-tools.ts          # Tool definitions + implementations (7 tools)
│   └── applicant-agent.ts     # Claude-based orchestrator (main entry point)
├── scenarios/
│   └── lvr-kol-registration.json  # Banterop scenario for LVR admin agent
├── scripts/
│   ├── upload-scenario.ts     # Upload scenario to banterop
│   └── setup-test-patient.ts  # Create synthetic KOL patient in COS sandbox
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Key FHIR codes used

| Variable | Code system | Code |
|----------|------------|------|
| FEV1 measured | LOINC | 20150-9 |
| FEV1 % predicted | LOINC | 19926-5 |
| FVC measured | LOINC | 19868-9 |
| FEV1/FVC ratio | LOINC | 40445-0 |
| BMI | LOINC | 39156-5 |
| Smoking status | LOINC | 72166-2 |
| COPD diagnosis | ICD-10 | J44.x |
| Tiotropium (LAMA) | ATC | R03BB04 |
| Budesonide+formoterol (ICS+LABA) | ATC | R03AK07 |

---

## References

- [banterop — Conversational Interoperability Testbed](https://github.com/jmandel/banterop)
- [LVR — Luftvägsregistret](https://lvr.registercentrum.se)
- [LVR Demo environment](https://lvr.demo.registercentrum.se/)
- [COS — Cambio Open Services](https://developer.openservices.cambio.se)
- [SKR Informationsspecifikationer for quality registries](https://skr.se/kvalitetsregister)
- [NKRR — Nationell källa för regionala rapporter](https://inera.se/nkrr)
