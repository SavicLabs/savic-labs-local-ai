/**
 * Re-exports for the routing module.
 */
export {
  classifyProviderRequest,
  classifyApiRequest,
  shouldForceThinkingNone,
  formatRequestLogLine,
  formatModelFields,
} from './classifier';
export type { RequestKind } from './classifier';
