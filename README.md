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

- COS sandbox credentials från [developer.openservices.cambio.se](https://developer.openservices.cambio.se)
- Anthropic API key
- Docker + Docker Compose **eller** [Bun](https://bun.sh) ≥ 1.2 (lokal utveckling)

---

## Snabbstart med Docker (rekommenderat för demo)

### Alternativ A — Helt lokalt (ingen internet under demo)

Kräver Docker och att banterop-submodulen är hämtad.

```bash
# 1. Hämta banterop-submodulen
git submodule update --init --recursive

# 2. Konfigurera miljövariabler
cp .env.example .env
# Fyll i COS_CLIENT_ID, COS_CLIENT_SECRET, ANTHROPIC_API_KEY
# För lokal banterop, lägg till LLM-nyckel för administratörsagenten:
#   BANTEROP_LLM_PROVIDER=openrouter
#   OPENROUTER_API_KEY=sk-or-...
# (eller GOOGLE_API_KEY för Gemini)

# 3. Starta banterop
docker compose --profile local up banterop -d

# 4. Ladda upp LVR-scenariot
docker compose --profile local run --rm agent-tools scripts/upload-scenario.ts

# 5. Skapa testpatient i COS
docker compose --profile local run --rm agent-tools scripts/setup-test-patient.ts

# 6. Öppna banterop i webbläsaren, skapa ett rum med LVR-scenariot, kopiera room-ID
open http://localhost:3000

# 7. Kör agenten
docker compose --profile local run --rm agent --room=<roomId>
```

### Alternativ B — Agent lokalt, banterop hostad (banterop.fhir.me)

```bash
cp .env.example .env
# Fyll i COS_*, ANTHROPIC_API_KEY, BANTEROP_ROOM_ID

# Skapa testpatient
docker compose --profile hosted run --rm agent-tools-hosted scripts/setup-test-patient.ts

# Ladda upp scenario (kräver BANTEROP_EDIT_TOKEN om published)
docker compose --profile hosted run --rm agent-tools-hosted scripts/upload-scenario.ts

# Kör agenten
docker compose --profile hosted run --rm agent-hosted --room=<roomId>
```

---

## Setup utan Docker (Bun direkt)

### 1. Installera beroenden

```bash
bun install
```

### 2. Konfigurera miljövariabler

```bash
cp .env.example .env
# Edit .env and fill in:
#   COS_FHIR_BASE_URL, COS_TOKEN_URL, COS_CLIENT_ID, COS_CLIENT_SECRET
#   ANTHROPIC_API_KEY
#   BANTEROP_URL (default: https://banterop.fhir.me)
```

### 3. Skapa testpatient i COS

```bash
bun run setup-patient --dry-run   # förhandsgranskning
bun run setup-patient             # skapa i COS sandbox
```

Skapar **Karl Andersson** (personnummer `195001011234`):
- Diagnos J44.1 (KOL med akut exacerbation)
- Spirometri: FEV1 62 % av förväntat, FEV1/FVC 0.58 → GOLD 2 (Moderate)
- Läkemedel: Spiriva (LAMA) + Symbicort (LABA+ICS)
- Ex-rökare (slutade 2019), BMI 24.5

### 4. Ladda upp LVR-scenariot till banterop

```bash
bun run upload-scenario --dry-run    # validera JSON
bun run upload-scenario              # ladda upp
```

Scenariot (`scenarios/lvr-kol-registration.json`) definierar LVR-administratörsagenten: obligatoriska/valfria fält, GOLD-klassificering, ATC-läkemedelsgrupper och valideringsregler.

### 5. Create a banterop room

1. Open [banterop.fhir.me](https://banterop.fhir.me) in a browser
2. Go to **Scenarios** → find `lvr-kol-outpatient-v1`
3. Click **Create room** — this generates a room ID (e.g. `abc-123-xyz`)
4. Add to `.env`: `BANTEROP_ROOM_ID=abc-123-xyz`

---

## Köra demon

Öppna **två skärmar** bredvid varandra:

**Skärm 1 — LVR-administratör (banterop i webbläsare)**
```
# Lokal Docker:
http://localhost:3000/rooms/<room-id>

# Hostad:
https://banterop.fhir.me/rooms/<room-id>
```
LVR-agentens tankekedja och verktygsanrop visas här i realtid — bra för publik.

**Skärm 2 — Applicant agent (terminal)**
```bash
# Docker (lokal):
docker compose --profile local run --rm agent --room=abc-123-xyz --patient=195001011234

# Docker (hostad):
docker compose --profile hosted run --rm agent-hosted --room=abc-123-xyz

# Bun direkt:
bun run agent --room=abc-123-xyz --patient=195001011234
```

Terminalen visar FHIR-anrop mot COS i blått, LVR-meddelanden i grönt.

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
