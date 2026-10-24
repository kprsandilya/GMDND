/** Validation helpers for journey-related inputs. Used by JourneyRepository and tests. */

export interface JourneyNameResult {
  valid: boolean;
  trimmed: string;
  error?: string;
}

/**
 * Validates and trims a journey name.
 * - Trims leading/trailing whitespace
 * - Rejects empty / whitespace-only strings
 * - Rejects names longer than 200 characters after trimming
 */
export function validateJourneyName(name: string): JourneyNameResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, trimmed, error: "Journey name must not be empty" };
  }
  if (trimmed.length > 200) {
    return { valid: false, trimmed, error: "Journey name must not exceed 200 characters" };
  }
  return { valid: true, trimmed };
}
