import OpenAI from "openai";
import { getSettings } from "../db.js";

function clientFromSettings(settings) {
  const apiKey = settings.moonshot_api_key || process.env.MOONSHOT_API_KEY || "";
  if (!apiKey) {
    throw new Error("Moonshot API key missing. Set it in System Settings or MOONSHOT_API_KEY.");
  }
  return new OpenAI({
    apiKey,
    baseURL: settings.llm_base_url || "https://api.moonshot.ai/v1",
  });
}

export async function chatCompletion(db, { messages }) {
  const settings = getSettings(db);
  const client = clientFromSettings(settings);
  const model = settings.llm_model || "kimi-k3";
  const params = {
    model,
    messages,
  };
  // kimi-k3 locks sampling server-side — sending temperature/top_p causes HTTP 400
  const isKimiK3 = /^kimi-k3/i.test(model);
  if (!isKimiK3) {
    params.temperature = 0.7;
  }
  if (settings.reasoning_effort) {
    params.reasoning_effort = settings.reasoning_effort;
  }
  try {
    const completion = await client.chat.completions.create(params);
    return completion.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    const detail =
      err?.error?.message ||
      err?.message ||
      String(err);
    throw new Error(detail);
  }
}

function parseJsonBlob(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("LLM did not return valid JSON");
  }
}

function buildCoachSystem(settings, target) {
  const parts = [
    settings.system_guidelines || "",
    settings.self_context
      ? `About the user (the person sending texts):\n${settings.self_context}`
      : "",
    `Per-conversation shaping for ${target.name || target.phone}:`,
    `- Tone: ${target.tone}`,
    `- Style: ${target.style}`,
    `- Length: ${target.content_length}`,
    `- Push toward first date: ${target.push_for_date ? "yes" : "no"}`,
    target.custom_instructions
      ? `Extra instructions:\n${target.custom_instructions}`
      : "",
    target.memory_summary
      ? `Compacted memory of this conversation (vital facts — preserve these):\n${target.memory_summary}`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function formatThread(messages) {
  return messages
    .map((m) => {
      const who = m.direction === "inbound" ? "Them" : "You";
      return `${who}: ${m.body}`;
    })
    .join("\n");
}

/**
 * Single LLM call → three styled SMS options.
 */
export async function generateThreeReplies(db, { target, recentMessages, inboundText }) {
  const settings = getSettings(db);
  const system = buildCoachSystem(settings, target);

  const userPrompt = `A new inbound SMS arrived. Draft THREE alternative replies the user could send.

Latest inbound message:
"""
${inboundText}
"""

Recent thread (oldest → newest):
${formatThread(recentMessages) || "(no prior messages)"}

Return ONLY valid JSON with this exact shape:
{
  "options": [
    { "style": "Normal", "message": "the SMS text" },
    { "style": "short label", "message": "the SMS text" },
    { "style": "short label", "message": "the SMS text" }
  ]
}

Rules:
- Exactly 3 options.
- Option 1 MUST be labeled "Normal": a natural, balanced reply that matches the shaping settings without being overly bold or gimmicky — the default safe choice.
- Options 2 and 3 must be meaningfully different flavored alternatives (e.g. playful / direct / warm / teasing) while still respecting the shaping settings.
- Each message must be ready to send as SMS (no quotes wrapping the whole text, no "Option 1:" prefixes).
- Match length preference (${target.content_length}).
- Sound like a real human texting, not a coach explaining strategy.`;

  const raw = await chatCompletion(db, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = parseJsonBlob(raw);
  const options = Array.isArray(parsed.options) ? parsed.options : [];
  if (options.length < 3) {
    throw new Error("LLM returned fewer than 3 options");
  }

  const normalized = options.slice(0, 3).map((opt, i) => ({
    style_label: String(opt.style || `Option ${i + 1}`).slice(0, 40),
    body: String(opt.message || "").trim(),
  }));
  // Guarantee first slot reads as Normal even if the model renames it
  normalized[0].style_label = "Normal";
  return normalized;
}

/**
 * Compact older messages into memory_summary without losing vital history.
 */
export async function compactMemory(db, { target, olderMessages, existingSummary }) {
  if (!olderMessages.length) return existingSummary || "";

  const settings = getSettings(db);
  const system = `You maintain a compact dating-conversation memory for an SMS coach.
Merge the existing summary with older messages. Keep only vital lasting facts:
names, preferences, plans, jokes that matter, boundaries, date logistics, emotional tone shifts.
Drop filler and one-off small talk. Write in concise third-person bullets or short paragraphs.
Do not invent facts.`;

  const userPrompt = `Existing memory summary:
${existingSummary || "(none)"}

Older messages to fold in:
${formatThread(olderMessages)}

Return ONLY the updated memory summary text (no JSON).`;

  return chatCompletion(db, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  });
}

export { clientFromSettings, buildCoachSystem, formatThread };
