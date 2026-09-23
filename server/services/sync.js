import { getSettings, messageFingerprint, nowIso } from "../db.js";
import { compactMemory, generateThreeReplies } from "./llm.js";
import { readThread, sendMessage, checkLogin, normalizePhone } from "../../lib/google-voice.mjs";

function getRecentMessages(db, targetId, limit) {
  return db
    .prepare(
      `SELECT * FROM messages
       WHERE target_id = ? AND compacted = 0
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(targetId, limit)
    .reverse();
}

export async function maybeCompactTarget(db, targetId) {
  const settings = getSettings(db);
  const keep = Math.max(8, Number(settings.keep_recent_messages) || 24);
  const threshold = Math.max(keep + 5, Number(settings.compact_when_over) || 40);

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE target_id = ? AND compacted = 0")
    .get(targetId).c;

  if (count <= threshold) return null;

  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetId);
  const all = db
    .prepare(
      `SELECT * FROM messages WHERE target_id = ? AND compacted = 0 ORDER BY id ASC`,
    )
    .all(targetId);

  const older = all.slice(0, all.length - keep);
  if (!older.length) return null;

  const summary = await compactMemory(db, {
    target,
    olderMessages: older,
    existingSummary: target.memory_summary,
  });

  const mark = db.prepare("UPDATE messages SET compacted = 1 WHERE id = ?");
  const tx = db.transaction(() => {
    for (const m of older) mark.run(m.id);
    db.prepare(
      "UPDATE targets SET memory_summary = ?, updated_at = ? WHERE id = ?",
    ).run(summary, nowIso(), targetId);
  });
  tx();

  return summary;
}

function insertMessage(db, targetId, { direction, body, gv_timestamp }) {
  const fp = messageFingerprint(direction, body, gv_timestamp);
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO messages
       (target_id, direction, body, gv_timestamp, fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(targetId, direction, body, gv_timestamp || "", fp, nowIso());

  if (info.changes === 0) return null;
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
}

function pendingDraftSet(db, targetId) {
  return db
    .prepare(
      `SELECT * FROM draft_sets WHERE target_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    )
    .get(targetId);
}

function getDraftsForSet(db, draftSetId) {
  return db
    .prepare(`SELECT * FROM drafts WHERE draft_set_id = ? ORDER BY sort_order ASC, id ASC`)
    .all(draftSetId);
}

export function getPendingDraftBundle(db, targetId) {
  const set = pendingDraftSet(db, targetId);
  if (!set) return null;
  return { ...set, drafts: getDraftsForSet(db, set.id) };
}

async function createDraftsForInbound(db, target, inboundMessage) {
  const existing = pendingDraftSet(db, target.id);
  if (existing) return getPendingDraftBundle(db, target.id);

  const settings = getSettings(db);
  const keep = Math.max(8, Number(settings.keep_recent_messages) || 24);
  const recent = getRecentMessages(db, target.id, keep);

  const options = await generateThreeReplies(db, {
    target,
    recentMessages: recent,
    inboundText: inboundMessage.body,
  });

  const createdAt = nowIso();
  const tx = db.transaction(() => {
    const setInfo = db
      .prepare(
        `INSERT INTO draft_sets (target_id, trigger_message_id, status, created_at)
         VALUES (?, ?, 'pending', ?)`,
      )
      .run(target.id, inboundMessage.id, createdAt);

    const insertDraft = db.prepare(
      `INSERT INTO drafts (draft_set_id, style_label, body, sort_order)
       VALUES (?, ?, ?, ?)`,
    );
    options.forEach((opt, i) => {
      insertDraft.run(setInfo.lastInsertRowid, opt.style_label, opt.body, i);
    });
    return setInfo.lastInsertRowid;
  });

  const setId = tx();
  return getPendingDraftBundle(db, target.id) || { id: setId, drafts: options };
}

/**
 * Pull Google Voice thread for one target, ingest new messages, generate drafts for new inbound.
 */
export async function syncTarget(db, targetId, { generate = true } = {}) {
  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetId);
  if (!target) throw new Error("Target not found");

  const { messages: gvMessages } = await readThread(target.phone, { limit: 80 });
  const inserted = [];

  for (const m of gvMessages) {
    const row = insertMessage(db, target.id, {
      direction: m.direction,
      body: m.text,
      gv_timestamp: m.timestamp || "",
    });
    if (row) inserted.push(row);
  }

  db.prepare("UPDATE targets SET last_synced_at = ?, updated_at = ? WHERE id = ?").run(
    nowIso(),
    nowIso(),
    target.id,
  );

  await maybeCompactTarget(db, target.id);

  let draftBundle = getPendingDraftBundle(db, target.id);
  const newInbound = inserted.filter((m) => m.direction === "inbound");
  const tip = db
    .prepare(
      `SELECT * FROM messages WHERE target_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(target.id);

  // Only draft when the thread tip is inbound AND that tip was just ingested
  // (so we don't regenerate for old unanswered history after a later outbound).
  const tipIsNewInbound =
    tip &&
    tip.direction === "inbound" &&
    inserted.some((m) => m.id === tip.id);

  if (generate && tipIsNewInbound && !draftBundle) {
    const refreshed = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id);
    draftBundle = await createDraftsForInbound(db, refreshed, tip);
  }

  return {
    target: db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id),
    inserted,
    newInboundCount: newInbound.length,
    pendingDrafts: draftBundle,
    messages: getRecentMessages(db, target.id, 200),
  };
}

export async function syncAllTargets(db) {
  const loggedIn = await checkLogin();
  if (!loggedIn) {
    throw new Error(
      "GV is not signed in. Open Reconnect GV in Wingman, or run npm run login on the server.",
    );
  }

  const targets = db.prepare("SELECT * FROM targets ORDER BY updated_at DESC").all();
  const results = [];
  for (const t of targets) {
    try {
      results.push(await syncTarget(db, t.id));
    } catch (err) {
      results.push({
        target: t,
        error: err?.message || String(err),
        inserted: [],
        newInboundCount: 0,
        pendingDrafts: getPendingDraftBundle(db, t.id),
      });
    }
  }
  return { loggedIn: true, results };
}

export async function sendChosenDraft(db, { draftId, editedBody }) {
  const draft = db
    .prepare(
      `SELECT d.*, ds.target_id, ds.status AS set_status, ds.id AS draft_set_id
       FROM drafts d
       JOIN draft_sets ds ON ds.id = d.draft_set_id
       WHERE d.id = ?`,
    )
    .get(draftId);

  if (!draft) throw new Error("Draft not found");
  if (draft.set_status !== "pending") throw new Error("Draft set is no longer pending");

  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(draft.target_id);
  const body = (editedBody != null ? String(editedBody) : draft.body).trim();
  if (!body) throw new Error("Message body is empty");

  const delayMs = Math.max(0, Number(target.response_delay_seconds) || 0) * 1000;
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  await sendMessage(normalizePhone(target.phone), body);

  const outbound = insertMessage(db, target.id, {
    direction: "outbound",
    body,
    gv_timestamp: "",
  });

  const tx = db.transaction(() => {
    db.prepare("UPDATE drafts SET selected = 1, body = ? WHERE id = ?").run(body, draft.id);
    db.prepare("UPDATE draft_sets SET status = 'sent' WHERE id = ?").run(draft.draft_set_id);
  });
  tx();

  await maybeCompactTarget(db, target.id);

  return {
    target: db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id),
    outbound,
    draftSetId: draft.draft_set_id,
  };
}

/**
 * Send a freeform SMS (compose box), dismiss any pending draft trio.
 */
export async function sendFreeform(db, { targetId, body, applyDelay = true }) {
  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetId);
  if (!target) throw new Error("Target not found");
  const text = String(body || "").trim();
  if (!text) throw new Error("Message body is empty");

  if (applyDelay) {
    const delayMs = Math.max(0, Number(target.response_delay_seconds) || 0) * 1000;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  await sendMessage(normalizePhone(target.phone), text);

  const outbound = insertMessage(db, target.id, {
    direction: "outbound",
    body: text,
    gv_timestamp: "",
  });

  const pending = pendingDraftSet(db, targetId);
  if (pending) {
    db.prepare("UPDATE draft_sets SET status = 'dismissed' WHERE id = ?").run(pending.id);
  }

  await maybeCompactTarget(db, target.id);

  return {
    target: db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id),
    outbound,
    pendingDrafts: null,
    messages: getRecentMessages(db, target.id, 200),
  };
}

export async function regenerateDrafts(db, targetId) {
  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetId);
  if (!target) throw new Error("Target not found");

  const pending = pendingDraftSet(db, targetId);
  if (pending) {
    db.prepare("UPDATE draft_sets SET status = 'dismissed' WHERE id = ?").run(pending.id);
  }

  const lastInbound = db
    .prepare(
      `SELECT * FROM messages WHERE target_id = ? AND direction = 'inbound'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(targetId);

  if (!lastInbound) throw new Error("No inbound message to reply to");

  return createDraftsForInbound(db, target, lastInbound);
}

export { getRecentMessages };
