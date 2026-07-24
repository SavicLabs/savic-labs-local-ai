/**
 * Image message resolution for the vision proxy.
 *
 * Detects image parts in user messages, describes them via the vision
 * describer, and substitutes text descriptions for the image data.
 * Historical image messages are replayed from cached replay markers.
 */
import * as vscode from 'vscode';
import { logger } from '../../logger';
import { t } from '../../i18n';
import { getVisionPrompt } from '../../config';
import { DEFAULT_VISION_PROMPT } from './consts';
import type { VisionDescriber } from './service';
import type { ReplayMarkerMetadata } from '../replay/markers';

export interface VisionResolutionResult {
  messages: vscode.LanguageModelChatMessage[];
  visionModelId?: string;
  visionProxySource: string;
  initialResponseNotice?: string;
  replayMarkerMetadata: ReplayMarkerMetadata;
  stats: VisionStats;
}

export interface VisionStats {
  imageCount: number;
  descriptionChars: number;
  markerVisionTextChars?: number;
}

/**
 * Resolve image messages for the given message list.
 * Returns modified messages with images replaced by text descriptions.
 */
export async function resolveImageMessages(
  messages: vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken,
  getVisionDescriber: () => Promise<VisionDescriber | undefined>
): Promise<VisionResolutionResult> {
  const stats: VisionStats = { imageCount: 0, descriptionChars: 0 };
  const replayMetadata: ReplayMarkerMetadata = {};

  // Find the latest user message with images
  let latestImageMsgIndex = -1;
  let latestImageParts: { index: number; part: vscode.LanguageModelDataPart }[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== vscode.LanguageModelChatMessageRole.User) {
      continue;
    }

    const imageParts: { index: number; part: vscode.LanguageModelDataPart }[] = [];
    for (const [partIdx, part] of msg.content.entries()) {
      if (
        part instanceof vscode.LanguageModelDataPart &&
        part.mimeType.toLowerCase().startsWith('image/')
      ) {
        imageParts.push({ index: partIdx, part });
      }
    }

    if (imageParts.length > 0) {
      latestImageMsgIndex = i;
      latestImageParts = imageParts;
      break;
    }
  }

  // No images found
  if (latestImageMsgIndex < 0) {
    return {
      messages,
      visionProxySource: 'none',
      replayMarkerMetadata: replayMetadata,
      stats,
    };
  }

  stats.imageCount = latestImageParts.length;

  // Get vision describer
  const describer = await getVisionDescriber();

  if (!describer) {
    throw new Error(t('image.notSupported'));
  }

  // Get prompt
  const customPrompt = getVisionPrompt();
  const prompt = customPrompt || DEFAULT_VISION_PROMPT;

  // Describe images
  const imageDataParts = latestImageParts.map((p) => p.part);
  let description: string;
  try {
    description = await describer.describe(imageDataParts, prompt);
  } catch (e) {
    logger.error('Vision description failed', e);
    throw new Error(
      `Failed to describe image: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  stats.descriptionChars = description.length;

  // Build the replacement message
  const originalMsg = messages[latestImageMsgIndex];
  const newParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
  const replacedIndices = new Set(latestImageParts.map((p) => p.index));

  for (const [i, part] of originalMsg.content.entries()) {
    if (replacedIndices.has(i)) {
      continue;
    }
    if (part instanceof vscode.LanguageModelTextPart) {
      newParts.push(part);
    } else if (part instanceof vscode.LanguageModelDataPart) {
      newParts.push(part);
    }
  }

  // Add vision description as a formatted text part
  const visionNotice = `[Image description provided by ${describer.modelId}]\n\n${description}`;
  newParts.push(new vscode.LanguageModelTextPart(visionNotice));

  // Build new message array with replacement
  const newMessages = [...messages];
  newMessages[latestImageMsgIndex] = vscode.LanguageModelChatMessage.User(newParts);

  // Store in replay metadata
  replayMetadata.visionText = description;

  const initialNotice = t('vision.describing', { model: describer.modelId });

  return {
    messages: newMessages,
    visionModelId: describer.modelId,
    visionProxySource: 'vscode-lm',
    initialResponseNotice: `> ${initialNotice}\n\n`,
    replayMarkerMetadata: replayMetadata,
    stats: {
      ...stats,
      markerVisionTextChars: description.length,
    },
  };
}
