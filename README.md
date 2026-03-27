# Conversational Interop Demo — Vitalis 2025

**COSMIC/COS <-> Luftvarsregistret (LVR)**

Two AI agents negotiate a quality registry submission in real-time conversation — no pre-built integration required. The EHR agent queries live FHIR data from the COS sandbox; the LVR registry agent knows the variable definitions and validation rules. Guided by the [banterop](https://github.com/jmandel/banterop) architecture.

---

## How it works

```
Terminal (our code)                         Browser (banterop)
───────────────────────────────────         ───────────────────────────────
Applicant Agent                             LVR Administrator Agent
  Claude claude-opus-4-6 orchestrates                 Scenario: lvr-kol-outpatient-v1
  |                                           Knows: mandatory fields, GOLD
  +-- FHIR tools ──> COS FHIR R4 API          staging, ATC groups, rules
  +-- MCP <──────────────────────────────> banterop room
```

---

## Prerequisites

- Docker + Docker Compose
- COS (Cambio Open Services) client credentials — [developer.openservices.cambio.se](https://developer.openservices.cambio.se)
- Anthropic API key

---

## Setup — hosted banterop.fhir.me (recommended)

### Step 1 — Clone

```bash
git clone --recurse-submodules <repo-url>
cd coin-demo
```

### Step 2 — Configure

```bash
cp .env.example .env
```

Fill in `.env`:

```
COS_FHIR_BASE_URL=https://...
COS_TOKEN_URL=https://...
COS_CLIENT_ID=...
COS_CLIENT_SECRET=...
ANTHROPIC_API_KEY=...
```

### Step 3 — Create test patient in COS

```bash
docker compose --profile hosted run --rm agent-tools-hosted scripts/setup-test-patient.ts
```

Creates **Karl Andersson** (personnummer `195001011234`) with:
- Diagnosis J44.1 (COPD with acute exacerbation)
- Spirometry: FEV1 62% predicted, FEV1/FVC 0.58 → GOLD 2 (Moderate)
- Medications: Spiriva (LAMA) + Symbicort (LABA+ICS)
- Former smoker (quit 2019), BMI 24.5

### Step 4 — Create a banterop room

1. Open [banterop.fhir.me](https://banterop.fhir.me) in a browser
2. Go to **Scenarios** — create a new scenario and paste in the contents of `scenarios/lvr-kol-registration.json`
3. Go to **Scenarios → lvr-kol-outpatient-v1 → Run**
4. Configure the room:
   - **Step 1:** Choose `ehr_applicant_agent` (this is the agent our code provides)
   - **Step 2:** Choose **I have a Client**
   - **Step 3:** Choose **MCP Protocol**
   - **Step 4:** banterop will simulate `lvr_administrator_agent`
5. Click **Open Client & Connect** — a room URL is generated
6. Copy the room ID from the URL (e.g. `abc-123-xyz`)

### Step 5 — Add room ID to .env

```
BANTEROP_ROOM_ID=abc-123-xyz
```

### Step 6 — Run the demo

Open two windows side by side:

**Window 1 — Browser**
```
https://banterop.fhir.me/rooms/<room-id>
```
The LVR agent's reasoning and tool calls are visible here in real time.

**Window 2 — Terminal**
```bash
docker compose --profile hosted run --rm agent-hosted --room=<room-id>
```

The terminal shows FHIR queries to COS in blue and LVR messages in green.

---

## Setup — fully local Docker (no internet during demo)

### Step 1 — Clone and fetch submodule

```bash
git clone --recurse-submodules <repo-url>
cd coin-demo
# If already cloned without --recurse-submodules:
git submodule update --init
```

The nested `a2a` submodule inside banterop is fetched automatically during Docker build — no need for `--recursive`.

### Step 2 — Configure

```bash
cp .env.example .env
```

Fill in `.env` — in addition to COS and Anthropic keys, add an LLM key for the local banterop instance:

```
COS_FHIR_BASE_URL=https://...
COS_TOKEN_URL=https://...
COS_CLIENT_ID=...
COS_CLIENT_SECRET=...
ANTHROPIC_API_KEY=...

BANTEROP_LLM_PROVIDER=google
GOOGLE_API_KEY=...
# or: BANTEROP_LLM_PROVIDER=openrouter + OPENROUTER_API_KEY=...
```

### Step 3 — Start banterop

```bash
docker compose --profile local up banterop -d
```

First run takes a few minutes (builds banterop and clones the a2a spec).

### Step 4 — Create banterop room

1. Open [http://localhost:3000](http://localhost:3000) in a browser
2. Create a scenario — paste in `scenarios/lvr-kol-registration.json`
3. Go to **Scenarios → lvr-kol-outpatient-v1 → Run**
4. Configure: `ehr_applicant_agent` / I have a Client / MCP Protocol
5. Copy the room ID

### Step 5 — Create test patient in COS

```bash
docker compose --profile local run --rm agent-tools scripts/setup-test-patient.ts
```

### Step 6 — Add room ID to .env

```
BANTEROP_ROOM_ID=abc-123-xyz
```

### Step 7 — Run the demo

**Window 1 — Browser**
```
http://localhost:3000/rooms/<room-id>
```

**Window 2 — Terminal**
```bash
docker compose --profile local run --rm agent --room=<room-id>
```

---

## Demo narrative (Vitalis script)

1. **Setup** (~1 min): "A patient with COPD has just had an outpatient visit. The EHR has their data. The quality registry needs a specific set of variables. Normally this requires a custom integration that takes months. Today we will do it with conversation."

2. **Agent starts** (~30 s): Applicant agent looks up the patient in COS, opens the chat with the LVR admin agent.

3. **LVR requests data** (~1 min): LVR lists what it needs — audience sees the registry's structured knowledge base in action.

4. **FHIR queries** (~1 min): Applicant queries spirometry, medications, smoking status from COS. Audience sees real FHIR API calls.

5. **CAT score gap** (~30 s): LVR asks for CAT score. Applicant reports it is not in the EHR (it was filled in on paper). LVR accepts with a flag. *This is the key moment* — conversational negotiation of what is available vs what is required.

6. **Registration complete**: LVR submits with a completeness summary showing what was registered and what was flagged.

7. **Discussion**: "This is what NKRR was meant to enable — but most registers are not connected yet. This demo shows what is possible today."

---

## Project structure

```
coin-demo/
├── src/
│   ├── cos-client.ts           # OAuth2 + FHIR R4 client for COS
│   ├── fhir-tools.ts           # 7 FHIR tools (patient, conditions, medications,
│   │                           #   spirometry, vitals, smoking, encounters)
│   └── applicant-agent.ts      # Claude orchestrator — main entry point
├── scenarios/
│   └── lvr-kol-registration.json  # Banterop scenario (both agents defined)
├── scripts/
│   ├── setup-test-patient.ts   # Create Karl Andersson in COS sandbox
│   └── upload-scenario.ts      # Upload scenario to banterop via API
├── docker/
│   └── banterop.Dockerfile     # Custom build that fetches a2a during Docker build
├── vendor/
│   └── banterop/               # Banterop git submodule
├── docker-compose.yml          # Profiles: local, hosted
├── Dockerfile                  # Applicant agent container
└── .env.example
```

---

## Key FHIR codes

| Variable | System | Code |
|----------|--------|------|
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

- [banterop](https://github.com/jmandel/banterop) — Conversational Interoperability Testbed
- [LVR — Luftvarsregistret](https://lvr.registercentrum.se)
- [COS — Cambio Open Services](https://developer.openservices.cambio.se)
- [NKRR — Nationell kalla for regionala rapporter](https://inera.se/nkrr)
