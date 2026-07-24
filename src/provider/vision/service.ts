/**
 * Vision service — manages the vision describer used for the vision proxy.
 * When a user sends an image to a text-only local model, the vision proxy
 * describes it using another Copilot model and feeds the text description.
 */
import * as vscode from 'vscode';
import { logger } from '../../logger';
import { t } from '../../i18n';
import { getVisionModelId } from '../../config';

export interface VisionDescriber {
  modelId: string;
  describe(imageDataParts: vscode.LanguageModelDataPart[], prompt: string): Promise<string>;
}

export class VisionService {
  private currentDescriber: VisionDescriber | undefined;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Get the current vision describer.
   * Returns undefined if no vision-capable model is available.
   */
  async get(): Promise<VisionDescriber | undefined> {
    const configuredModelId = getVisionModelId();

    if (configuredModelId) {
      // User configured a specific model
      if (this.currentDescriber?.modelId === configuredModelId) {
        return this.currentDescriber;
      }
      try {
        this.currentDescriber = await createVSCodeDescriber(configuredModelId);
        return this.currentDescriber;
      } catch (e) {
        logger.warn('Configured vision model not available:', configuredModelId, e);
        return undefined;
      }
    }

    // Auto-detect: find first available vision-capable Copilot model
    if (this.currentDescriber) {
      return this.currentDescriber;
    }

    try {
      this.currentDescriber = await autoDetectVisionDescriber();
      return this.currentDescriber;
    } catch (e) {
      logger.warn('No vision-capable model available for auto-detection', e);
      return undefined;
    }
  }

  /**
   * Open the vision model configuration UI.
   */
  async openConfiguration(): Promise<void> {
    // Try to find available vision-capable models
    let availableModels: string[] = [];
    try {
      const models = await vscode.lm.selectChatModels();
      availableModels = models
        .filter((m) => (m as { capabilities?: { imageInput?: boolean } }).capabilities?.imageInput)
        .map((m) => `${m.vendor}/${m.family}/${m.id}`);
    } catch {
      // Ignore — will show empty list
    }

    const NO_MODEL = '__none__';
    const items: vscode.QuickPickItem[] = [
      { label: '$(zap) Auto-detect', description: 'Use first available vision model' },
      ...availableModels.map((id) => ({ label: id })),
    ];

    if (items.length === 1) {
      void vscode.window.showWarningMessage(t('vision.noModel'));
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a model for image description (vision proxy)',
    });

    if (!selected) {
      return;
    }

    const config = vscode.workspace.getConfiguration('savicLabs');
    if (selected.label === items[0].label) {
      await config.update('visionModel', '', vscode.ConfigurationTarget.Global);
      this.currentDescriber = undefined;
    } else {
      await config.update('visionModel', selected.label, vscode.ConfigurationTarget.Global);
      this.currentDescriber = undefined; // Force refresh on next get()
    }

    void vscode.window.showInformationMessage(t('vision.configured'));
  }
}

/**
 * Auto-detect a vision-capable model from installed Copilot models.
 */
async function autoDetectVisionDescriber(): Promise<VisionDescriber | undefined> {
  const models = await vscode.lm.selectChatModels();
  const visionModel = models.find(
    (m) => (m as { capabilities?: { imageInput?: boolean } }).capabilities?.imageInput
  );
  if (!visionModel) {
    return undefined;
  }

  const modelId = `${visionModel.vendor}/${visionModel.family}/${visionModel.id}`;
  return createVSCodeDescriber(modelId);
}

/**
 * Create a describer that uses a VS Code language model.
 */
async function createVSCodeDescriber(modelId: string): Promise<VisionDescriber> {
  // Parse vendor/family/id from modelId string
  const parts = modelId.split('/');
  const vendor = parts[0] || 'copilot';
  const family = parts[1];

  const models = await vscode.lm.selectChatModels({ vendor });
  const model = family
    ? models.find((m) => m.family === family || m.id === parts.slice(1).join('/'))
    : models.find(
        (m) => (m as { capabilities?: { imageInput?: boolean } }).capabilities?.imageInput
      );

  if (!model) {
    throw new Error(`Vision model not found: ${modelId}`);
  }

  return {
    modelId,
    describe: async (
      imageDataParts: vscode.LanguageModelDataPart[],
      prompt: string
    ): Promise<string> => {
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User([
          new vscode.LanguageModelTextPart(prompt),
          ...imageDataParts,
        ]),
      ];

      const response = await model.sendRequest(
        messages,
        { modelOptions: { max_tokens: 2000 } } as vscode.LanguageModelChatRequestOptions,
        new vscode.CancellationTokenSource().token
      );

      // Collect text from response
      const parts: string[] = [];
      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          parts.push(chunk.value);
        }
      }

      return parts.join('');
    },
  };
}
