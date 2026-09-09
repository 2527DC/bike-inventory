// Pull the JSON value out of a model reply. Models wrap the value in a ```json fence or lead
// with a sentence of prose despite being told not to, and a parser that only accepts the
// bare value fails a perfectly good answer. This replaces the `text.match(/\[[\s\S]*\]/)`
// scraping that three call sites each carried their own copy of.
import { createLogger } from "@/lib/logger";
import { AiError } from "./types";

const log = createLogger("ai:json");

// A whole-reply fence: optional language tag, the body, the closing fence. Lazy body so a
// fence inside a JSON string does not end it early.
const FENCE = /^\s*```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```\s*$/;

const CLOSER = { "[": "]", "{": "}" } as const;

/** Index of the first `[` or `{`, and one past the LAST matching closer for that opener. */
function outermostSpan(s: string): [number, number] | null {
  const opens = ["[", "{"].map((c) => s.indexOf(c)).filter((i) => i !== -1);
  if (opens.length === 0) return null;
  const start = Math.min(...opens);
  const end = s.lastIndexOf(CLOSER[s[start] as keyof typeof CLOSER]);
  return end > start ? [start, end + 1] : null;
}

export function parseJsonReply(text: string): unknown {
  const fenced = FENCE.exec(text);
  const body = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(body);
  } catch (first) {
    // Prose around the value. Take the outermost bracket pair and try once more.
    const span = outermostSpan(body);
    log.debug("bare JSON.parse failed, trying the bracketed span", {
      chars: body.length,
      fenced: fenced !== null,
      span: span !== null,
    });
    if (span) {
      try {
        return JSON.parse(body.slice(span[0], span[1]));
      } catch (second) {
        log.warn("reply is not JSON", { chars: body.length, error: (second as Error).message });
        throw new AiError("parse", "The AI reply was not valid JSON", { cause: second });
      }
    }
    log.warn("reply is not JSON and has no bracketed span", {
      chars: body.length,
      error: (first as Error).message,
    });
    throw new AiError("parse", "The AI reply was not valid JSON", { cause: first });
  }
}
