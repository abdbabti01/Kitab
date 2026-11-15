import { useEffect } from "react";
import { recommend, type Evidence } from "../learning/networking-path.ts";
import type { LearnSection } from "./routes.ts";
import { NetworkingPath } from "./NetworkingPath.tsx";

/** The Learn destination. This first version shows the networking roadmap; tracks and the Library follow. */
export function LearnPage({ section, evidence }: { section: LearnSection; evidence: Evidence }) {
  useEffect(() => {
    document.title = "Learn · Kitab";
  }, []);
  return (
    <main id="main" className="page">
      {section === "networking" && <NetworkingPath evidence={evidence} recommendation={recommend(evidence)} />}
    </main>
  );
}
