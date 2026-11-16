import { useEffect, useReducer, useRef, useState } from "react";
import { Copy, Download, FolderOpen, Plus, Trash2, Upload, Workflow } from "lucide-react";
import { safeStorage } from "../../learning/progress.ts";
import { linkProps } from "../../app/router.ts";
import type { Design } from "../model.ts";
import { DesignFormatError } from "../validate.ts";
import { editorReducer, initEditor } from "../editor.ts";
import { deleteDesign, duplicateDesign, exportDesign, importDesign, loadDesigns, newDesignId, saveDesign, type SavedDesigns } from "../persistence.ts";
import { findTemplate, templates } from "../templates.ts";
import { Workspace } from "./Workspace.tsx";
import "./architecture.css";

function setQuery(id: string) {
  window.history.replaceState(window.history.state, "", `/practice/architecture?design=${encodeURIComponent(id)}`);
}

function fromTemplate(templateId: string): Design {
  const template = findTemplate(templateId) ?? templates[0];
  const now = new Date().toISOString();
  return { ...template.design(), id: newDesignId(), name: template.id === "blank" ? "Untitled design" : template.title, createdAt: now, updatedAt: now };
}

/** Which design to open: the one in the address, a new one from a template, or the most recent. */
function initial(saved: SavedDesigns): Design | null {
  const query = new URLSearchParams(window.location.search);
  const template = query.get("template");
  if (template && findTemplate(template)) {
    const design = fromTemplate(template);
    saveDesign(safeStorage(), design);
    setQuery(design.id);
    return design;
  }
  const id = query.get("design");
  return saved.designs.find((d) => d.id === id) ?? (id ? null : saved.designs[0] ?? null);
}

function Templates({ onPick }: { onPick: (id: string) => void }) {
  return (
    <ul className="template-grid">
      {templates.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onPick(t.id)}>
            <b>{t.title}</b>
            <span>{t.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** /practice/architecture: build, save and simulate your own designs. */
export function ArchitecturePlayground() {
  const storage = safeStorage();
  const [saved, setSaved] = useState(() => loadDesigns(storage));
  const [first] = useState(() => initial(saved));
  const [state, dispatch] = useReducer(editorReducer, first, (d) => initEditor(d ?? fromTemplate("blank")));
  const [open, setOpen] = useState(Boolean(first));
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const missing = new URLSearchParams(window.location.search).get("design") && !first;

  useEffect(() => {
    document.title = "Architecture Playground · Kitab";
  }, []);

  // Every change is saved on this device, shortly after the last edit, and at once when the page is left.
  const design = state.design;
  const latest = useRef(design);
  latest.current = design;
  // A deleted design is never saved again, whichever save would otherwise run next.
  const deleted = useRef(new Set<string>());
  const keep = (d: Design) => !deleted.current.has(d.id) && saveDesign(storage, d);
  useEffect(() => {
    if (!open) return;
    const flush = () => keep(latest.current);
    window.addEventListener("pagehide", flush);
    return () => (window.removeEventListener("pagehide", flush), void flush());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (deleted.current.has(design.id)) return;
      const ok = saveDesign(storage, design);
      setStatus(ok ? "Saved on this device" : "Couldn't save: storage is full or unavailable. Export the design to keep it.");
      if (ok) setSaved(loadDesigns(storage));
    }, 400);
    return () => clearTimeout(timer);
  }, [design, open]);

  const openDesign = (next: Design) => {
    // Keep the last edits of the design being left (its debounced save would be cancelled).
    if (open && next.id !== latest.current.id) keep(latest.current);
    dispatch({ type: "load", design: next });
    setOpen(true);
    setQuery(next.id);
    dialog.current?.close();
    setMessage(`Opened “${next.name}”.`);
  };
  const create = (templateId: string) => {
    const next = fromTemplate(templateId);
    if (!saveDesign(storage, next)) return setMessage("Couldn't create a design: you have the maximum of 50, or storage is unavailable. Delete one first.");
    setSaved(loadDesigns(storage));
    openDesign(next);
  };
  const remove = (target: Design) => {
    if (!window.confirm(`Delete “${target.name}”? This can't be undone.`)) return;
    deleted.current.add(target.id);
    deleteDesign(storage, target.id);
    const rest = loadDesigns(storage);
    setSaved(rest);
    setMessage(`Deleted “${target.name}”.`);
    if (target.id === design.id) {
      if (rest.designs[0]) openDesign(rest.designs[0]);
      else {
        setOpen(false);
        window.history.replaceState(window.history.state, "", "/practice/architecture");
      }
    }
  };
  const duplicate = (target: Design) => {
    const copy = duplicateDesign(storage, target);
    if (!copy) return setMessage("Couldn't duplicate: you have the maximum of 50 designs, or storage is unavailable.");
    setSaved(loadDesigns(storage));
    openDesign(copy);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportDesign(design)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${design.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "design"}.kitab-architecture.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = importDesign(await file.text());
      if (!saveDesign(storage, imported)) return setMessage("Couldn't import: you have the maximum of 50 designs, or storage is unavailable.");
      setSaved(loadDesigns(storage));
      openDesign(imported);
    } catch (error) {
      setMessage(error instanceof DesignFormatError ? `Couldn't import “${file.name}”: ${error.message}` : `Couldn't read “${file.name}”.`);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const designsDialog = (
    <dialog ref={dialog} className="arch-dialog lab-theme" aria-labelledby="designs-title">
      <div className="dialog-head">
        <h2 id="designs-title">Your designs</h2>
        <button type="button" className="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <p className="muted">Saved in this browser only. Export a design to keep a copy or move it to another device.</p>
      {saved.designs.length === 0 && <p>No saved designs yet.</p>}
      <ul className="design-rows">
        {saved.designs.map((d) => (
          <li key={d.id} aria-current={d.id === design.id && open ? "true" : undefined}>
            <button type="button" className="design-open" onClick={() => openDesign(d)}>
              <b>{d.name}</b>
              <small>{d.nodes.length} components · changed {new Date(d.updatedAt).toLocaleString()}</small>
            </button>
            <button type="button" className="icon-button" aria-label={`Duplicate ${d.name}`} onClick={() => duplicate(d)}><Copy aria-hidden="true" /></button>
            <button type="button" className="icon-button danger" aria-label={`Delete ${d.name}`} onClick={() => remove(d)}><Trash2 aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      {saved.unreadable.length > 0 && (
        <p className="inline-issue is-warning">
          {saved.unreadable.length} saved {saved.unreadable.length === 1 ? "design" : "designs"} couldn't be opened ({saved.unreadable[0].reason}). {saved.unreadable.length === 1 ? "It is" : "They are"} kept unchanged.
        </p>
      )}
      <h3>Start a new design</h3>
      <Templates onPick={create} />
    </dialog>
  );

  return (
    <main id="main" className="page arch-playground lab-theme">
      <header className="arch-heading">
        <div className="playground-title">
          <Workflow className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">System Design · Playground</p>
            <h1>Architecture Playground</h1>
            <p>Design an application from real building blocks, send simulated traffic through it, and see where it slows down or breaks, and why.</p>
          </div>
        </div>
        <p className="heading-links">
          <a {...linkProps("/learn/system-design")}>System Design track</a> · <a {...linkProps("/practice?track=system-design")}>Design challenges</a> · <a {...linkProps("/practice/architecture/labs")}>Architecture labs</a>
        </p>
      </header>
      <p className="sr-only" role="status">{message}</p>
      {message && <p className="arch-message">{message}</p>}
      {designsDialog}
      {missing && <p className="inline-issue is-warning">That design isn't saved in this browser. Designs are kept on the device where they were made.</p>}

      {!open ? (
        <section className="arch-start" aria-labelledby="start-title">
          <h2 id="start-title">Start a design</h2>
          <p>Pick a starting point. Every design is saved in this browser as you work.</p>
          <Templates onPick={create} />
          <div className="actions">
            {saved.designs.length > 0 && <button type="button" className="button" onClick={() => dialog.current?.showModal()}><FolderOpen aria-hidden="true" /> Open a saved design</button>}
            <button type="button" className="button" onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" /> Import a file</button>
          </div>
        </section>
      ) : (
        <Workspace
          state={state}
          dispatch={dispatch}
          fitKey={design.id}
          toolbar={
            <>
              <label className="design-name">
                <span className="sr-only">Design name</span>
                <input value={design.name} maxLength={80} onChange={(event) => dispatch({ type: "rename-design", name: event.target.value })} onBlur={() => dispatch({ type: "settle" })} />
              </label>
              <span className="save-status" role="status">{status}</span>
              <span className="toolbar-actions">
                <button type="button" className="button" onClick={() => dialog.current?.showModal()}><FolderOpen aria-hidden="true" /> Designs</button>
                <button type="button" className="button" onClick={() => { dialog.current?.showModal(); }}><Plus aria-hidden="true" /> New</button>
                <button type="button" className="icon-button" onClick={() => duplicate(design)} aria-label="Duplicate this design" title="Duplicate"><Copy aria-hidden="true" /></button>
                <button type="button" className="icon-button" onClick={download} aria-label="Export this design as a file" title="Export"><Download aria-hidden="true" /></button>
                <button type="button" className="icon-button" onClick={() => fileInput.current?.click()} aria-label="Import a design file" title="Import"><Upload aria-hidden="true" /></button>
                <button type="button" className="icon-button danger" onClick={() => remove(design)} aria-label="Delete this design" title="Delete"><Trash2 aria-hidden="true" /></button>
              </span>
            </>
          }
        />
      )}
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => upload(event.target.files?.[0])} />
    </main>
  );
}
