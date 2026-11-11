import type { Lesson } from "../learning/lessons/schema.ts";

type Term = Lesson["glossary"][number];

/** A term's meaning, the same way in lessons and missions: what it is, why we use it, and an example. */
export function TermFields({ term }: { term: Term }) {
  return (
    <dl className="term-fields">
      <div><dt>What it is</dt><dd>{term.definition}</dd></div>
      {term.purpose && <div><dt>Why we use it</dt><dd>{term.purpose}</dd></div>}
      {term.example && <div><dt>Example</dt><dd>{term.example}</dd></div>}
    </dl>
  );
}

/** Terms as a row of chips, after an optional visible lead; each opens to its meaning. */
export function TermChips({ label, terms, lead }: { label: string; terms: Term[]; lead?: string }) {
  return (
    <div className="terms" aria-label={label}>
      {lead && <span className="terms-lead">{lead}</span>}
      {terms.map((term) => (
        <details className="term" key={term.id}>
          <summary>{term.term}</summary>
          {term.purpose ? <TermFields term={term} /> : <p>{term.definition}</p>}
        </details>
      ))}
    </div>
  );
}
