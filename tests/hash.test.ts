import { describe, expect, it } from "vitest";
import { normaliseKey, stableHash } from "../src/main/hash";

describe("hash utilities", () => {
  describe("stableHash", () => {
    it("produces a deterministic 12-char hex string", () => {
      const first = stableHash("test");
      const second = stableHash("test");
      expect(first).toBe(second);
      expect(first).toHaveLength(12);
      expect(/^[a-f0-9]+$/.test(first)).toBe(true);
    });

    it("produces different hashes for different inputs", () => {
      expect(stableHash("fibbage")).not.toBe(stableHash("quiplash"));
    });

    it("is case sensitive", () => {
      expect(stableHash("Game")).not.toBe(stableHash("game"));
    });
  });

  describe("normaliseKey", () => {
    it("lowercases", () => {
      expect(normaliseKey("Fibbage")).toBe("fibbage");
    });

    it("replaces ampersands", () => {
      expect(normaliseKey("Fibbage & Stuff")).toBe("fibbage-and-stuff");
    });

    it("strips non-alphanumerics and joins with dashes", () => {
      expect(normaliseKey("Hello, World!")).toBe("hello-world");
    });

    it("collapses multiple whitespace into single dash", () => {
      expect(normaliseKey("  Hello   World  ")).toBe("hello-world");
    });

    it("handles mixed special characters", () => {
      expect(normaliseKey("Tee K.O. 2")).toBe("tee-k-o-2");
    });

    it("handles parentheses", () => {
      expect(normaliseKey("Game (2020)")).toBe("game-2020");
    });

    it("returns empty string for purely non-alphanumeric input", () => {
      expect(normaliseKey("!!!")).toBe("");
    });

    it("handles game names with numbers", () => {
      expect(normaliseKey("Quiplash 3")).toBe("quiplash-3");
    });
  });
});
