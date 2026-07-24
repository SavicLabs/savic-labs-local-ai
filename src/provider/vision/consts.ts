/**
 * Vision proxy constants.
 */

/** Default vision description prompt. */
export const DEFAULT_VISION_PROMPT =
  'Describe all image attachments in this message.\n\n' +
  'If there is one image, describe it directly.\n' +
  'If there are multiple images:\n' +
  '1. Describe each image separately, preserving their order.\n' +
  '2. Then provide a combined description explaining the overall context and relationships across the images.\n\n' +
  'Return one concise factual description suitable for inserting into a text-only chat prompt. ' +
  'Include visible text, objects, UI elements, people, and relevant context. Do not invent details.';
