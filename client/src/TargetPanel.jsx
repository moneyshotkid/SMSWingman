import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.js";

const LENGTHS = ["short", "medium", "long"];
const TONES = ["flirty", "warm", "playful", "confident", "chill", "witty"];
const STYLES = ["casual", "smooth", "direct", "teasing", "sincere"];

function IconPeople() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4 20a7 7 0 0 1 16 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChevron({ open }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSync() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TargetPanel({
  targetId,
  onTargetsChanged,
  onToast,
  onError,
  onOpenNav,
  onBusyChange,
  interactionLocked = false,
}) {
  const [target, setTarget] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingDrafts, setPendingDrafts] = useState(null);
  const [edits, setEdits] = useState({});
  const [compose, setCompose] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef(null);
  const latestRef = useRef(null);

  const locked = busy || interactionLocked;
  const title = String(target?.name || "").trim() || target?.phone || "Target";
  const showPhoneUnder = Boolean(String(target?.name || "").trim());

  const beginBusy = useCallback(
    (message, detail = "") => {
      setBusy(true);
      onBusyChange?.(true, message, detail);
    },
    [onBusyChange],
  );

  const beginGvBusy = useCallback(
    (message) => {
      beginBusy(message, "Patience is a virtue.");
    },
    [beginBusy],
  );

  const endBusy = useCallback(() => {
    setBusy(false);
    onBusyChange?.(false);
  }, [onBusyChange]);

  const load = useCallback(async ({ withBusy = true } = {}) => {
    if (withBusy) beginBusy("Loading conversation…");
    try {
      const data = await api.getTarget(targetId);
      setTarget(data.target);
      setMessages(data.messages || []);
      setPendingDrafts(data.pendingDrafts);
      const map = {};
      for (const d of data.pendingDrafts?.drafts || []) {
        map[d.id] = d.body;
      }
      setEdits(map);
    } finally {
      if (withBusy) endBusy();
    }
  }, [targetId, beginBusy, endBusy]);

  useEffect(() => {
    load().catch((err) => {
      onError(err.message);
      endBusy();
    });
  }, [load, onError, endBusy]);

  useLayoutEffect(() => {
    if (tab !== "chat") return;
    latestRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [messages, pendingDrafts, tab, targetId]);

  if (!target) {
    return <div className="empty">Loading conversation…</div>;
  }

  const saveTarget = async (e) => {
    e.preventDefault();
    if (locked) return;
    beginBusy("Saving…");
    onError("");
    try {
      const { target: updated } = await api.updateTarget(target.id, target);
      setTarget(updated);
      await onTargetsChanged();
      onToast("Target settings saved");
      setTab("chat");
      setMenuOpen(false);
    } catch (err) {
      onError(err.message);
    } finally {
      endBusy();
    }
  };

  const syncOne = async () => {
    if (locked) return;
    beginGvBusy("Syncing with Google Voice…");
    onError("");
    try {
      const result = await api.syncTarget(target.id);
      setTarget(result.target);
      setMessages(result.messages || []);
      setPendingDrafts(result.pendingDrafts);
      const map = {};
      for (const d of result.pendingDrafts?.drafts || []) map[d.id] = d.body;
      setEdits(map);
      await onTargetsChanged();
      onToast(
        result.newInboundCount
          ? `${result.newInboundCount} new inbound — drafts ready`
          : "Thread synced",
      );
      setMenuOpen(false);
    } catch (err) {
      onError(err.message);
    } finally {
      endBusy();
    }
  };

  const regenerate = async () => {
    if (locked) return;
    beginBusy("Generating replies…");
    onError("");
    try {
      const { pendingDrafts: bundle } = await api.regenerate(target.id);
      setPendingDrafts(bundle);
      const map = {};
      for (const d of bundle?.drafts || []) map[d.id] = d.body;
      setEdits(map);
      setTab("chat");
      onToast("New draft trio generated");
      setMenuOpen(false);
    } catch (err) {
      onError(err.message);
    } finally {
      endBusy();
    }
  };

  const sendDraft = async (draftId) => {
    if (locked) return;
    beginGvBusy("Sending via Google Voice…");
    onError("");
    try {
      await api.sendDraft(draftId, edits[draftId]);
      setPendingDrafts(null);
      setEdits({});
      await load({ withBusy: false });
      await onTargetsChanged();
      onToast("Sent via Google Voice");
    } catch (err) {
      onError(err.message);
    } finally {
      endBusy();
    }
  };

  const sendCompose = async (e) => {
    e?.preventDefault?.();
    if (locked) return;
    const text = compose.trim();
    if (!text) return;
    beginGvBusy("Sending via Google Voice…");
    onError("");
    try {
      const result = await api.sendMessage(target.id, text);
      setCompose("");
      setPendingDrafts(null);
      setEdits({});
      setMessages(result.messages || []);
      setTarget(result.target);
      await onTargetsChanged();
      onToast("Sent via Google Voice");
    } catch (err) {
      onError(err.message);
    } finally {
      endBusy();
    }
  };

  const remove = async () => {
    if (locked) return;
    if (!confirm(`Delete ${title}? This removes the saved conversation and drafts.`)) return;
    beginBusy("Deleting…");
    try {
      await api.deleteTarget(target.id);
      await onTargetsChanged();
      onToast("Target deleted");
    } catch (err) {
      onError(err.message);
    } finally {
      endBusy();
    }
  };

  const setField = (key) => (e) => {
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setTarget((t) => ({ ...t, [key]: value }));
  };

  return (
    <>
      <div className={`chat-chrome ${menuOpen ? "is-expanded" : "is-collapsed"}`}>
        <div className="chat-chrome-bar">
          <button
            type="button"
            className="icon-btn nav-toggle"
            aria-label="Open contacts"
            disabled={locked}
            onClick={onOpenNav}
          >
            <IconPeople />
          </button>

          <button
            type="button"
            className="chat-identity"
            disabled={locked}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
          >
            <span className="chat-identity-name">{title}</span>
            {showPhoneUnder && menuOpen ? (
              <span className="chat-identity-sub">{target.phone}</span>
            ) : null}
            <IconChevron open={menuOpen} />
          </button>

          <div className="chat-quick-actions">
            <button
              type="button"
              className="icon-btn"
              title="Sync"
              disabled={locked}
              onClick={syncOne}
            >
              <IconSync />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Regen drafts"
              disabled={locked}
              onClick={regenerate}
            >
              <IconSpark />
            </button>
            <button
              type="button"
              className={`icon-btn ${tab === "shape" ? "is-active" : ""}`}
              title="Shape LLM"
              disabled={locked}
              onClick={() => {
                setTab(tab === "shape" ? "chat" : "shape");
                setMenuOpen(true);
              }}
            >
              <IconSliders />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="chat-chrome-panel">
            <div className="chat-menu-grid">
              <button
                type="button"
                className={`btn ${tab === "chat" ? "btn-primary" : ""}`}
                disabled={locked}
                onClick={() => {
                  setTab("chat");
                  setMenuOpen(false);
                }}
              >
                Chat
              </button>
              <button
                type="button"
                className={`btn ${tab === "shape" ? "btn-primary" : ""}`}
                disabled={locked}
                onClick={() => setTab("shape")}
              >
                Shape LLM
              </button>
              <button type="button" className="btn" disabled={locked} onClick={syncOne}>
                Sync thread
              </button>
              <button type="button" className="btn" disabled={locked} onClick={regenerate}>
                Regen drafts
              </button>
            </div>
            {!showPhoneUnder && (
              <p className="muted chat-phone-line">{target.phone}</p>
            )}
            {target.last_synced_at && (
              <p className="muted chat-phone-line">
                Synced {new Date(target.last_synced_at).toLocaleString()}
              </p>
            )}
            <button
              type="button"
              className="btn btn-danger btn-block"
              disabled={locked}
              onClick={remove}
            >
              <span className="btn-with-icon">
                <IconTrash /> Delete target
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="panel" ref={panelRef}>
        {tab === "shape" ? (
          <form className="card form-grid" onSubmit={saveTarget} style={{ maxWidth: 760 }}>
            <div className="form-grid two">
              <label>
                Name
                <input value={target.name} onChange={setField("name")} />
              </label>
              <label>
                Phone
                <input value={target.phone} onChange={setField("phone")} />
              </label>
              <label>
                Content length
                <select value={target.content_length} onChange={setField("content_length")}>
                  {LENGTHS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tone
                <select value={target.tone} onChange={setField("tone")}>
                  {TONES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Style
                <select value={target.style} onChange={setField("style")}>
                  {STYLES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Response delay (seconds)
                <input
                  type="number"
                  min="0"
                  value={target.response_delay_seconds}
                  onChange={setField("response_delay_seconds")}
                />
              </label>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={!!target.push_for_date}
                onChange={setField("push_for_date")}
              />
              Push for a first date
            </label>

            <label>
              Custom instructions for this person
              <textarea
                value={target.custom_instructions || ""}
                onChange={setField("custom_instructions")}
                placeholder="She likes hiking jokes… keep it low-pressure…"
              />
            </label>

            <label>
              LLM memory summary (editable)
              <textarea
                value={target.memory_summary || ""}
                onChange={setField("memory_summary")}
                placeholder="Auto-compacted facts appear here; you can edit anytime."
                style={{ minHeight: 160 }}
              />
            </label>

            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={locked}>
                Save
              </button>
              <button className="btn btn-danger" type="button" disabled={locked} onClick={remove}>
                Delete target
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="thread">
              {messages.length === 0 && (
                <p className="muted" style={{ textAlign: "center" }}>
                  No messages yet. Sync this thread from Google Voice.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={m.id}
                  className={`bubble ${m.direction}`}
                  ref={i === messages.length - 1 ? latestRef : undefined}
                >
                  {m.body}
                  <div className="meta">
                    {m.direction === "inbound" ? "Them" : "You"}
                    {m.gv_timestamp ? ` · ${m.gv_timestamp}` : ""}
                  </div>
                </div>
              ))}
            </div>

            {pendingDrafts?.drafts?.length > 0 && (
              <div className="drafts">
                <h3 style={{ fontFamily: "var(--display)", fontWeight: 400, margin: "0 0 0.25rem" }}>
                  Pick a reply
                </h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Three styles from one model call. Edit, then send — the other options disappear.
                </p>
                {pendingDrafts.drafts.map((d) => (
                  <div className="draft-card" key={d.id}>
                    <div className="style">{d.style_label}</div>
                    <textarea
                      value={edits[d.id] ?? d.body}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [d.id]: e.target.value }))
                      }
                      rows={3}
                    />
                    <div className="row" style={{ marginTop: "0.65rem" }}>
                      <button
                        className="btn btn-primary btn-block"
                        disabled={locked}
                        onClick={() => sendDraft(d.id)}
                      >
                        Send this
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form className="compose-bar" onSubmit={sendCompose}>
              <label className="compose-label" htmlFor="compose-input">
                Your message
              </label>
              <textarea
                id="compose-input"
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                placeholder="Type a text to send…"
                rows={3}
                disabled={locked}
              />
              <button
                className="btn btn-primary btn-block"
                type="submit"
                disabled={locked || !compose.trim()}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
