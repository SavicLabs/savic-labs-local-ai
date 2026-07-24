/**
 * Token estimation with adaptive calibration.
 *
 * Uses a chars-per-token ratio that is calibrated via exponential moving
 * average whenever real usage data is reported by the API.
 */
export function estimateTokenCount(text: string, charsPerToken: number): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

/**
 * Update the adaptive chars-per-token ratio using exponential moving average.
 * newRatio = oldRatio * 0.7 + observedRatio * 0.3
 */
export function updateCharsPerToken(
  totalRequestChars: number,
  promptTokens: number,
  currentCharsPerToken: number
): number {
  if (totalRequestChars > 0 && promptTokens > 0) {
    const observedRatio = totalRequestChars / promptTokens;
    return currentCharsPerToken * 0.7 + observedRatio * 0.3;
  }
  return currentCharsPerToken;
}
