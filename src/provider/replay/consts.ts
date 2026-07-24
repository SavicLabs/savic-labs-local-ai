/**
 * Replay marker constants.
 */

/** MIME type for replay marker data parts embedded in assistant messages. */
export const REPLAY_MARKER_MIME = 'x-application/saviclabs-replay-marker';

/** Writer identifier prefix for replay markers. */
export const REPLAY_MARKER_WRITER_ID = 'savicLabs';

/** Known replay marker prefixes. */
export const REPLAY_MARKER_PREFIXES = new Set([REPLAY_MARKER_WRITER_ID]);
