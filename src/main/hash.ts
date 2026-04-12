import { createHash } from "node:crypto";

export function stableHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

export function normaliseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}
