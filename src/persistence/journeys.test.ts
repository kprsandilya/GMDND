import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateJourneyName } from "./repositories/journeyValidation";

/**
 * Property 13: Journey name validation
 * Validates: Requirements 3.2
 *
 * For any input string, creating a journey trims leading/trailing whitespace
 * and requires the trimmed name to be between 1 and 200 characters.
 * Empty strings, whitespace-only strings, and strings exceeding 200 characters
 * after trimming are rejected.
 */
describe("journey name validation (Property 13)", () => {
  it("trims leading and trailing whitespace from the name", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.string({ unit: fc.constant(" "), minLength: 0, maxLength: 5 }),
          fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length >= 1 && s.trim().length <= 200),
          fc.string({ unit: fc.constant(" "), minLength: 0, maxLength: 5 }),
        ),
        ([leading, core, trailing]) => {
          const input = leading + core + trailing;
          const result = validateJourneyName(input);
          expect(result.trimmed).toBe(input.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts valid names (1–200 characters after trimming)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => {
          const t = s.trim();
          return t.length >= 1 && t.length <= 200;
        }),
        (name) => {
          const result = validateJourneyName(name);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
          expect(result.trimmed.length).toBeGreaterThanOrEqual(1);
          expect(result.trimmed.length).toBeLessThanOrEqual(200);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects empty strings", () => {
    const result = validateJourneyName("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.trimmed).toBe("");
  });

  it("rejects whitespace-only strings", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(" ", "\t", "\n", "\r"), minLength: 1, maxLength: 50 }),
        (ws) => {
          const result = validateJourneyName(ws);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.trimmed).toBe("");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects strings exceeding 200 characters after trimming", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 201, maxLength: 500 }).filter((s) => s.trim().length > 200),
        (longName) => {
          const result = validateJourneyName(longName);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("names at exactly 200 characters are accepted", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1 }).filter((c) => c.trim().length > 0),
        (c) => {
          const name = c.repeat(200);
          const result = validateJourneyName(name);
          expect(result.valid).toBe(true);
          expect(result.trimmed.length).toBe(200);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("names at exactly 201 characters are rejected", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1 }).filter((c) => c.trim().length > 0),
        (c) => {
          const name = c.repeat(201);
          const result = validateJourneyName(name);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
