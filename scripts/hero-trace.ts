// Writes src/app/hero-trace.json, the homepage's recording of a real run (see src/practice/network/hero.ts).
import fs from "node:fs";
import { heroTrace } from "../src/practice/network/hero.ts";

fs.writeFileSync(new URL("../src/app/hero-trace.json", import.meta.url), `${JSON.stringify(heroTrace(), null, 1)}\n`);
