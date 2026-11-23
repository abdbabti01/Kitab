import { ArrowRight } from "lucide-react";
import { linkProps } from "../app/router.ts";
import type { ConceptLearn } from "../learning/concept-learn.ts";

/** The one contextual way from a lesson into its Playground, already set up. */
export function ExploreLink({ explore }: { explore: NonNullable<ConceptLearn["explore"]> }) {
  return (
    <p className="demo-explore">
      <a className="button" {...linkProps(explore.path)}>{explore.label} <ArrowRight aria-hidden="true" /></a>
      <span>{explore.detail}</span>
    </p>
  );
}
