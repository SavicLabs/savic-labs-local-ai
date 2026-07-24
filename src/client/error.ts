/**
 * Error types and normalization for the SavicLabs HTTP client.
 */

/** HTTP-level error with status code and response body. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, body: string) {
    super(`HTTP ${statusCode}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.responseBody = body;
  }
}

/** Network-level error (fetch failure, DNS, connection refused, etc.). */
export class NetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** User-facing error with a message suitable for display. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

interface ErrorContext {
  baseUrl: string;
  request: unknown;
}

/** Create an HttpError from a fetch Response. */
export async function createHttpError(
  response: Response,
  _context: ErrorContext
): Promise<HttpError> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    body = '(could not read response body)';
  }
  return new HttpError(response.status, body);
}

/** Normalize any error into a typed error. */
export function normalizeRequestError(error: unknown, _context: ErrorContext): Error {
  if (error instanceof HttpError || error instanceof NetworkError) {
    return error;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('econnreset') ||
      msg.includes('network') ||
      msg.includes('dns')
    ) {
      return new NetworkError(error.message, error);
    }
    return error;
  }
  return new Error(String(error));
}

/** Create a user-friendly error from any error. */
export function createUserFacingError(error: unknown): Error {
  if (error instanceof HttpError) {
    return new UserFacingError(
      `Server error (HTTP ${error.statusCode}). Check your endpoint URL and server status.`
    );
  }
  if (error instanceof NetworkError) {
    return new UserFacingError(
      `Cannot connect to ${error.message}. Make sure your llama.cpp server is running.`
    );
  }
  if (error instanceof Error) {
    return new UserFacingError(error.message);
  }
  return new UserFacingError(String(error));
}

/** Check if an error is an abort/cancellation error. */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('cancelled') ||
      error.message.includes('canceled')
    );
  }
  return false;
}
