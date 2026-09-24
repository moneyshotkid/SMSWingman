import { useEffect, useState } from "react";
import { api } from "./api.js";

const EMPTY = {
  self_context: "",
  system_guidelines: "",
  moonshot_api_key: "",
  llm_base_url: "https://api.openai.com/v1",
  llm_model: "gpt-4o-mini",
  reasoning_effort: "low",
  keep_recent_messages: "24",
  compact_when_over: "40",
};

export default function SettingsPanel({ onSaved, onError, onReconnect }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then(({ settings }) => setForm({ ...EMPTY, ...settings }))
      .catch((err) => onError(err.message));
  }, [onError]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    onError("");
    try {
      const { settings } = await api.saveSettings(form);
      setForm({ ...EMPTY, ...settings });
      onSaved("System settings saved");
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h2>System settings</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Context about you and how the model should behave across every conversation.
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="card" style={{ maxWidth: 760 }}>
          <h3>GV session</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            When the GV session expires, autofill the sign-in and finish 2FA in the portal, or open
            the desktop inside Wingman instead of a separate VNC app.
          </p>
          <div className="row">
            <button
              className="btn btn-reconnect-gv"
              type="button"
              disabled={autofillBusy}
              onClick={onAutofill}
            >
              {autofillBusy ? "Signing in…" : "Reconnect Google Voice"}
            </button>
            <button className="btn btn-primary" type="button" onClick={onReconnect}>
              Open GV desktop
            </button>
          </div>
        </div>
        <form className="card form-grid" onSubmit={save} style={{ maxWidth: 760 }}>
          <label>
            About you (self context)
            <textarea
              value={form.self_context}
              onChange={set("self_context")}
              placeholder="Age, vibe, interests, dealbreakers, how you usually text…"
            />
          </label>
          <label>
            System-wide response guidelines
            <textarea
              value={form.system_guidelines}
              onChange={set("system_guidelines")}
              placeholder="Always sound like me. Never use emojis. Keep it light…"
            />
          </label>

          <div className="form-grid two">
            <label>
              LLM API key
              <input
                type="password"
                value={form.moonshot_api_key}
                onChange={set("moonshot_api_key")}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>
            <label>
              Model
              <input value={form.llm_model} onChange={set("llm_model")} />
            </label>
            <label>
              Base URL
              <input value={form.llm_base_url} onChange={set("llm_base_url")} />
            </label>
            <label>
              Reasoning effort
              <select value={form.reasoning_effort} onChange={set("reasoning_effort")}>
                <option value="low">low</option>
                <option value="high">high</option>
                <option value="max">max</option>
              </select>
            </label>
            <label>
              Keep recent messages
              <input
                type="number"
                min="8"
                value={form.keep_recent_messages}
                onChange={set("keep_recent_messages")}
              />
            </label>
            <label>
              Compact when over
              <input
                type="number"
                min="20"
                value={form.compact_when_over}
                onChange={set("compact_when_over")}
              />
            </label>
          </div>

          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
