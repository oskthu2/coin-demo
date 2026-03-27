#!/usr/bin/env bun
/**
 * Applicant Agent — COSMIC/COS side of the conversational interop demo.
 *
 * This agent:
 *   1. Connects to a banterop room via MCP (Streamable HTTP transport)
 *   2. Uses Claude to orchestrate the conversation
 *   3. Answers the LVR administrator agent's requests by querying real
 *      patient data from the COS FHIR API
 *
 * Usage:
 *   bun run src/applicant-agent.ts --room=<roomId> --patient=<personnummer>
 *   bun run src/applicant-agent.ts  # uses env vars BANTEROP_ROOM_ID + DEFAULT_PERSONNUMMER
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";

import { cosClientFromEnv } from "./cos-client.js";
import { FHIR_TOOLS, executeFhirTool } from "./fhir-tools.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const BANTEROP_URL =
  process.env["BANTEROP_URL"] ?? "https://banterop.fhir.me";

const MODEL = "claude-opus-4-6";
const MAX_TURNS = 40; // safety ceiling for the agent loop

// ─── Colour helpers (ANSI) ────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

function log(prefix: string, colour: string, msg: string) {
  console.log(`${colour}${C.bold}[${prefix}]${C.reset} ${msg}`);
}

const info = (m: string) => log("AGENT", C.cyan, m);
const fhir = (m: string) => log("FHIR ", C.blue, m);
const lvr = (m: string) => log("LVR  ", C.green, m);
const think = (m: string) => log("THINK", C.dim, m);
const error = (m: string) => log("ERROR", C.red, m);

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const flag = args.find((a) => a.startsWith(`--${name}=`));
    return flag ? flag.split("=").slice(1).join("=") : undefined;
  };

  const roomId =
    get("room") ?? process.env["BANTEROP_ROOM_ID"];
  const personnummer =
    get("patient") ??
    process.env["DEFAULT_PERSONNUMMER"] ??
    "194706302595";

  if (!roomId) {
    console.error(
      `${C.red}${C.bold}Error:${C.reset} --room=<roomId> or BANTEROP_ROOM_ID env var is required.\n` +
        `  Example: bun run agent --room=abc123 --patient=195001011234\n` +
        `  Create a room at ${BANTEROP_URL}/rooms and load the LVR scenario first.`
    );
    process.exit(1);
  }

  return { roomId, personnummer };
}

// ─── Banterop MCP client ──────────────────────────────────────────────────────

async function connectBanterop(roomId: string): Promise<McpClient> {
  const mcpUrl = new URL(`${BANTEROP_URL}/api/rooms/${roomId}/mcp`);
  info(`Connecting to banterop room ${C.yellow}${roomId}${C.reset} at ${mcpUrl}`);

  const mcp = new McpClient(
    { name: "coin-demo-applicant-agent", version: "0.1.0" },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(mcpUrl);
  await mcp.connect(transport);

  const { tools } = await mcp.listTools();
  info(
    `Banterop tools available: ${tools.map((t) => C.yellow + t.name + C.reset).join(", ")}`
  );

  return mcp;
}

// Convert MCP tool list → Anthropic Tool[] (rename inputSchema → input_schema)
function mcpToolsToAnthropic(
  mcpTools: Array<{ name: string; description?: string; inputSchema: unknown }>
): Tool[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Tool["input_schema"],
  }));
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(personnummer: string): string {
  return `\
Du är EHR-agenten i en demo för konversationsbaserad interoperabilitet på Vitalis-konferensen.

Du företräder Lungmottagningen vid Västmanlands Sjukhus Västerås och ditt uppdrag är att registrera \
en patients KOL-uppföljningsbesök i Luftvägsregistret (LVR).

Kommunicera alltid på svenska — både i konversationen med LVR och i dina interna resonemang.

=== Your tools ===

FHIR tools (prefix fhir_*): Query the patient's clinical data from the COS FHIR R4 API.
  • fhir_find_patient     — look up the patient by personnummer, returns a FHIR patient ID
  • fhir_get_conditions   — get ICD-10 diagnoses (use icd10_prefix="J44" for COPD)
  • fhir_get_medications  — get active medications (use atc_prefix="R03" for respiratory drugs)
  • fhir_get_spirometry   — FEV1, FEV1 % predicted, FVC, FEV1/FVC ratio
  • fhir_get_vitals       — height, weight, BMI
  • fhir_get_smoking_status — smoking history
  • fhir_get_encounters   — care contacts / visit dates

Banterop/LVR tools (begin_chat_thread, send_message_to_chat_thread, check_replies):
  These connect you to the LVR registry intake agent running on the other side.

=== Workflow ===

1. Call begin_chat_thread — your opening message should ONLY be a brief introduction:
   introduce the clinic, state the purpose (COPD follow-up registration for this patient),
   and ask LVR to confirm what mandatory fields they need before you share any data.
2. Call check_replies to receive LVR's opening message (wait up to 30 s).
3. As LVR asks for specific data items:
   a. Use FHIR tools to fetch ONLY the values LVR requested.
   b. Format the result clearly and send it with send_message_to_chat_thread.
   c. Call check_replies to wait for the next message.
4. Repeat until LVR confirms the registration is complete.
5. If LVR asks for something you cannot find in the EHR (e.g., CAT score), say so explicitly.

=== Critical rules — MUST follow ===

• DO NOT call any FHIR tools before LVR has asked for specific data.
  Your first action is begin_chat_thread with a short intro, then check_replies.
  Only after receiving LVR's first reply should you start fetching clinical data.
• Fetch data on demand — only the fields LVR asks about, not everything at once.
• Present data in plain language (not raw JSON) in your messages TO LVR.
• If spirometry data is older than 12 months or missing, say so — do not fabricate values.
• CAT score is patient-reported and typically not in the EHR; acknowledge this if requested.
• Keep messages to LVR concise and structured (bullet points work well).

=== Patient ===

Personnummer: ${personnummer}

Start now by calling begin_chat_thread.`;
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

async function runAgent(
  anthropic: Anthropic,
  mcp: McpClient,
  allTools: Tool[],
  personnummer: string
): Promise<void> {
  const { tools: banteropMcpTools } = await mcp.listTools();
  // Re-fetch so we have the typed list; allTools already contains them

  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Please register the COPD patient visit (personnummer ${personnummer}) with the LVR registry now.`,
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    think(`Turn ${turn + 1}/${MAX_TURNS}`);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(personnummer),
      tools: allTools,
      messages,
    });

    // Collect tool calls and text from this response
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const texts = response.content.filter((b) => b.type === "text");

    for (const block of texts) {
      if (block.type === "text" && block.text.trim()) {
        think(block.text.trim().slice(0, 200));
      }
    }

    // Push assistant turn
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      info("Agent finished.");
      break;
    }

    // Execute all tool calls and collect results
    const toolResults: ToolResultBlockParam[] = [];

    for (const block of toolUses) {
      if (block.type !== "tool_use") continue;
      const { id, name, input } = block;
      const args = input as Record<string, unknown>;

      if (name.startsWith("fhir_")) {
        fhir(`Calling ${C.yellow}${name}${C.reset} ${JSON.stringify(args)}`);
        try {
          const result = await executeFhirTool(name, args, cosClientFromEnv());
          fhir(`  → ${result.slice(0, 200)}`);
          toolResults.push({ type: "tool_result", tool_use_id: id, content: result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          error(`FHIR tool error: ${msg}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: `Error: ${msg}`,
            is_error: true,
          });
        }
      } else {
        // Banterop MCP tool
        if (name === "send_message_to_chat_thread") {
          const text = (args.text ?? args.message ?? "") as string;
          lvr(`→ Sending to LVR:\n${C.green}${text}${C.reset}`);
        } else if (name === "check_replies") {
          info("Polling banterop for LVR reply…");
        } else if (name === "begin_chat_thread") {
          info("Starting chat thread with LVR administrator agent…");
        }

        try {
          const result = await mcp.callTool({ name, arguments: args });
          const content = result.content as Array<{ type: string; text?: string }>;
          const text = content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");

          if (name === "check_replies" && text.trim()) {
            lvr(`← LVR says:\n${C.green}${text}${C.reset}`);
          }

          toolResults.push({ type: "tool_result", tool_use_id: id, content: text });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          error(`Banterop tool error: ${msg}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: `Error: ${msg}`,
            is_error: true,
          });
        }
      }
    }

    messages.push({ role: "user", content: toolResults });
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const { roomId, personnummer } = parseArgs();

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════╗`);
  console.log(`║   Conversational Interop Demo — Vitalis 2025     ║`);
  console.log(`║   COSMIC/COS  ↔  Luftvägsregistret (LVR)         ║`);
  console.log(`╚══════════════════════════════════════════════════╝${C.reset}\n`);

  info(`Patient personnummer: ${C.yellow}${personnummer}${C.reset}`);
  info(`Banterop room:        ${C.yellow}${roomId}${C.reset}`);
  info(`LVR scenario UI:      ${C.yellow}${BANTEROP_URL}/rooms/${roomId}${C.reset}\n`);

  // Validate env
  const cosEnvOk =
    process.env["COS_FHIR_BASE_URL"] &&
    process.env["COS_TOKEN_URL"] &&
    process.env["COS_CLIENT_ID"] &&
    process.env["COS_CLIENT_SECRET"];

  if (!cosEnvOk) {
    error(
      "COS environment variables are missing. Copy .env.example → .env and fill in your credentials."
    );
    process.exit(1);
  }

  if (!process.env["ANTHROPIC_API_KEY"]) {
    error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

  // Connect MCP
  const mcp = await connectBanterop(roomId);
  const { tools: banteropMcpTools } = await mcp.listTools();
  const banteropTools = mcpToolsToAnthropic(
    banteropMcpTools as Array<{
      name: string;
      description?: string;
      inputSchema: unknown;
    }>
  );
  const allTools: Tool[] = [...FHIR_TOOLS, ...banteropTools];

  info(`Total tools available to Claude: ${allTools.length}\n`);

  try {
    await runAgent(anthropic, mcp, allTools, personnummer);
  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  error(String(err));
  process.exit(1);
});
