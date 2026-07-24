/**
 * Re-exports for the routing module.
 */
export {
  classifyProviderRequest,
  classifyDeepSeekRequest,
  shouldForceThinkingNone,
  formatRequestLogLine,
  formatModelFields,
} from './classifier';
export type { RequestKind } from './classifier';
