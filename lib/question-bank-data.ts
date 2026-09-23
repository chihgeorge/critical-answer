// The actual bundled question bank, parsed from data/question-bank.json — every question's
// answer lives in this module. SERVER-ONLY: never import this from a "use client" component or
// anything it might pull in. See lib/question-bank.ts's header comment for why this split
// exists — importing bankJson (even indirectly, via a re-export) from a client component ships
// the whole bank, answers included, in that page's public JS bundle, bypassing OWNER_KEY
// entirely. scripts/check-bundle.sh (run in CI) catches a regression of this if one slips in.

import bankJson from "../data/question-bank.json";
import { parseBank, type Bank } from "./question-bank";

export const BANK: Bank = parseBank(bankJson);
