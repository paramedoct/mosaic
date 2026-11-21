import type { ImageSearchTerm } from "../../providers/scry";

const fields = ["source", "tag"] as const;
type Facets = Record<typeof fields[number], readonly string[]>;
const tokenPattern = /(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*(?:"|$))+/g;

function readToken(token: string): ImageSearchTerm {
  const exclude = token.startsWith("-");
  const body = exclude ? token.slice(1) : token;
  const prefix = /^(source|tag):/i.exec(body);
  const field = fields.find(value => value === prefix?.[1].toLowerCase()) ?? "text";
  const raw = body.slice(prefix?.[0].length ?? 0);
  const quoted = /^"((?:[^"\\]|\\.)*)"?$/.exec(raw);
  const value = quoted ? quoted[1].replace(/\\(["\\])/g, "$1") : raw;
  return { field, value, exclude };
}

export function parseImageSearch(input: string): ImageSearchTerm[] {
  return (input.match(tokenPattern) ?? []).map(readToken).filter(term => term.value);
}

export function imageSearchChoices(input: string, facets: Facets): { label: string; value: string }[] {
  const tokens = [...input.matchAll(tokenPattern)];
  const last = tokens.at(-1);
  const active = last && last.index + last[0].length === input.length ? last : undefined;
  const term = readToken(active?.[0] ?? "");
  const preceding = active ? input.slice(0, active.index) : input;
  const negation = term.exclude ? "-" : "";
  const query = term.value.toLowerCase();
  const prefixes = term.field === "text" ? fields.filter(field => field.startsWith(query)) : [];
  const field = term.field === "text" ? "tag" : term.field;
  const format = (value: string) => /[\s"\\]/.test(value) ? JSON.stringify(value) : value;
  const matching = query || term.field !== "text"
    ? facets[field].filter(value => value.toLowerCase().includes(query)).slice(0, 5)
    : [];
  const entries = matching.map(value => {
    const label = negation + field + ":" + format(value);
    return { label, value: preceding + label + " " };
  });
  return [...prefixes.map(prefix => {
    const label = negation + prefix + ":";
    return { label, value: preceding + label };
  }), ...entries].slice(0, 5);
}
