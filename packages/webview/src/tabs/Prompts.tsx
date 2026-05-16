import React, { useState } from 'react';
import { useStore } from '../store.js';
import type { PromptDef, PromptArg } from '@shared/types.js';
import { Plus, ArrowLeft, Trash2, RotateCcw, Save, X, Info } from 'lucide-react';

// ─── Reconnect notice ─────────────────────────────────────────────────────────

function ReconnectNotice() {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '9px 12px',
      borderRadius: 8, border: '1px solid rgba(22,110,225,0.3)',
      background: 'rgba(22,110,225,0.08)', fontSize: '0.68rem', lineHeight: 1.5,
    }}>
      <Info size={13} style={{ color: 'var(--fg-info)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ color: 'var(--fg-subtle)' }}>
        <span style={{ color: 'var(--fg-info)', fontWeight: 600 }}>Reconnect required after changes. </span>
        Clients cache MCP capabilities at connect-time. After saving or adding prompts:
        <ul style={{ marginTop: 4, paddingLeft: 14 }}>
          <li><b>Cursor / Windsurf</b> — Reload Window (Ctrl+Shift+P)</li>
          <li><b>Claude Code</b> — Restart session or run <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem' }}>/mcp</code></li>
          <li><b>Claude Desktop</b> — Restart the app</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Arg row editor ───────────────────────────────────────────────────────────

function ArgRow({
  arg,
  onChange,
  onRemove,
}: {
  arg: PromptArg;
  onChange: (updated: PromptArg) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ flex: '0 0 90px' }}>
        <input
          value={arg.name}
          onChange={e => onChange({ ...arg, name: e.target.value })}
          placeholder="name"
          style={inputStyle}
          aria-label="Argument name"
        />
      </div>
      <div style={{ flex: 1 }}>
        <input
          value={arg.description}
          onChange={e => onChange({ ...arg, description: e.target.value })}
          placeholder="description"
          style={inputStyle}
          aria-label="Argument description"
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.65rem', color: 'var(--fg-muted)', cursor: 'pointer', flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={arg.required}
          onChange={e => onChange({ ...arg, required: e.target.checked })}
          style={{ accentColor: 'var(--at-blue)' }}
          aria-label="Required"
        />
        req
      </label>
      <button onClick={onRemove} style={{ color: 'var(--fg-muted)', padding: 2, flexShrink: 0 }} aria-label="Remove argument">
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Prompt editor ────────────────────────────────────────────────────────────

function PromptEditor({
  initial,
  isNew,
  onBack,
}: {
  initial: PromptDef;
  isNew: boolean;
  onBack: () => void;
}) {
  const { savePrompt, deletePrompt, resetPrompt } = useStore();
  const [name, setName]           = useState(initial.name);
  const [desc, setDesc]           = useState(initial.description);
  const [args, setArgs]           = useState<PromptArg[]>(initial.arguments);
  const [template, setTemplate]   = useState(initial.template);
  const [dirty, setDirty]         = useState(isNew);

  const nameIsValid = /^[a-z][a-z0-9-]*$/.test(name);

  function markDirty() { setDirty(true); }

  function handleSave() {
    if (!dirty || !nameIsValid) return;
    savePrompt({ name, description: desc, arguments: args, template, isBuiltin: initial.isBuiltin, isModified: initial.isBuiltin });
    onBack();
  }

  function handleDelete() {
    deletePrompt(initial.name);
    onBack();
  }

  function handleReset() {
    resetPrompt(initial.name);
    onBack();
  }

  function addArg() {
    setArgs(a => [...a, { name: '', description: '', required: false }]);
    markDirty();
  }

  function updateArg(i: number, updated: PromptArg) {
    setArgs(a => a.map((x, idx) => idx === i ? updated : x));
    markDirty();
  }

  function removeArg(i: number) {
    setArgs(a => a.filter((_, idx) => idx !== i));
    markDirty();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Back */}
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--fg-muted)', fontSize: '0.7rem', padding: 0 }}>
        <ArrowLeft size={12} /> Back to prompts
      </button>

      {/* Reconnect notice */}
      <ReconnectNotice />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, flex: 1 }}>{isNew ? 'New Prompt' : initial.name}</span>
        {initial.isBuiltin && <span className="chip chip-info" style={{ fontSize: '0.58rem' }}>built-in</span>}
        {initial.isModified && <span className="chip chip-warn" style={{ fontSize: '0.58rem' }}>modified</span>}
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>Slash command name</label>
        <input
          value={name}
          onChange={e => { setName(e.target.value); markDirty(); }}
          disabled={initial.isBuiltin}
          placeholder="my-prompt"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)', ...(initial.isBuiltin ? { opacity: 0.5 } : {}) }}
          aria-label="Prompt name"
        />
        {!nameIsValid && name.length > 0 && (
          <div style={{ fontSize: '0.62rem', color: 'var(--fg-err)', marginTop: 3 }}>
            Lowercase letters, digits, and hyphens only (must start with a letter)
          </div>
        )}
        <div style={{ fontSize: '0.62rem', color: 'var(--fg-muted)', marginTop: 3 }}>
          Appears as <code style={{ fontFamily: 'var(--font-mono)' }}>/{name || '…'}</code> in MCP clients
        </div>
      </div>

      {/* Description */}
      <div>
        <label style={labelStyle}>Description</label>
        <input
          value={desc}
          onChange={e => { setDesc(e.target.value); markDirty(); }}
          placeholder="What this prompt does"
          style={inputStyle}
          aria-label="Prompt description"
        />
      </div>

      {/* Arguments */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Arguments</label>
          <button onClick={addArg} className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={11} /> Add
          </button>
        </div>
        {args.length === 0 ? (
          <div style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', padding: '8px 0' }}>No arguments — this prompt has no user-fillable slots.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 6, padding: '0 8px 2px', fontSize: '0.6rem', color: 'var(--fg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              <span style={{ flex: '0 0 90px' }}>Name</span>
              <span style={{ flex: 1 }}>Description</span>
              <span style={{ width: 32 }} />
            </div>
            {args.map((arg, i) => (
              <ArgRow key={i} arg={arg} onChange={u => updateArg(i, u)} onRemove={() => removeArg(i)} />
            ))}
          </div>
        )}
        <div style={{ fontSize: '0.62rem', color: 'var(--fg-muted)', marginTop: 5 }}>
          Use <code style={{ fontFamily: 'var(--font-mono)' }}>{'{argName}'}</code> in the template to insert argument values
        </div>
      </div>

      {/* Template */}
      <div>
        <label style={labelStyle}>Template</label>
        <textarea
          value={template}
          onChange={e => { setTemplate(e.target.value); markDirty(); }}
          rows={12}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}
          aria-label="Prompt template"
          spellCheck={false}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={!dirty || !nameIsValid}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: !dirty || !nameIsValid ? 0.5 : 1 }}
        >
          <Save size={12} /> Save
        </button>

        {initial.isBuiltin && initial.isModified && (
          <button onClick={handleReset} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <RotateCcw size={12} /> Reset to default
          </button>
        )}

        {!initial.isBuiltin && (
          <button onClick={handleDelete} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--fg-err)' }}>
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Prompt list item ─────────────────────────────────────────────────────────

function PromptRow({ prompt, onClick }: { prompt: PromptDef; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="action-card"
      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, flex: 1, textAlign: 'left' }}>
          /{prompt.name}
        </span>
        {prompt.isBuiltin && <span className="chip chip-muted" style={{ fontSize: '0.55rem' }}>built-in</span>}
        {prompt.isModified && <span className="chip chip-warn" style={{ fontSize: '0.55rem' }}>modified</span>}
      </div>
      <span style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', textAlign: 'left', lineHeight: 1.4 }}>{prompt.description}</span>
    </button>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 8px',
  color: 'var(--fg)',
  fontSize: '0.72rem',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  fontWeight: 600,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 5,
};

// ─── Empty placeholder prompt for "new" ──────────────────────────────────────

function emptyPrompt(): PromptDef {
  return {
    name: '',
    description: '',
    arguments: [],
    template: '',
    isBuiltin: false,
    isModified: false,
  };
}

// ─── Main Prompts tab ─────────────────────────────────────────────────────────

export function Prompts() {
  const prompts = useStore(s => s.prompts?.prompts ?? []);
  const [editing, setEditing] = useState<{ prompt: PromptDef; isNew: boolean } | null>(null);

  if (editing) {
    return (
      <PromptEditor
        initial={editing.prompt}
        isNew={editing.isNew}
        onBack={() => setEditing(null)}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>MCP</div>
          <div style={{ marginTop: 2, fontSize: '0.85rem', fontWeight: 600 }}>Prompts</div>
          <div style={{ marginTop: 2, fontSize: '0.72rem', color: 'var(--fg-subtle)', lineHeight: 1.4 }}>
            Slash commands available in Claude, Cursor, and other MCP clients.
          </div>
        </div>
        <button
          onClick={() => setEditing({ prompt: emptyPrompt(), isNew: true })}
          className="btn btn-ghost btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, marginTop: 18 }}
        >
          <Plus size={12} /> New
        </button>
      </div>

      {/* Reconnect notice */}
      <ReconnectNotice />

      {/* List */}
      {prompts.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.72rem', padding: '24px 0' }}>
          No prompts yet. Create one with the New button.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {prompts.map(p => (
            <PromptRow
              key={p.name}
              prompt={p}
              onClick={() => setEditing({ prompt: p, isNew: false })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
