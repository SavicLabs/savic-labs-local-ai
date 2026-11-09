/**
 * Re-exports for the client module.
 */
export { SavicLabsClient } from './core';
export type { StreamCallbacks, ToolCall, Usage, ChatCompletionRequest } from './core';
export {
  HttpError,
  NetworkError,
  NonRetryableError,
  UserFacingError,
  createHttpError,
  normalizeRequestError,
  createUserFacingError,
  isAbortError,
} from './error';
