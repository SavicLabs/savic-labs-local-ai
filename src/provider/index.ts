/**
 * SavicLabsChatProvider — implements vscode.LanguageModelChatProvider
 * so local llama.cpp models appear in the Copilot Chat model picker.
 */
import * as vscode from 'vscode';
import { SavicLabsClient, createUserFacingError } from '../client';
import { getBaseUrl, getDebugLoggingEnabled } from '../config';
import { logger } from '../logger';
import { t } from '../i18n';
import { fetchModels, toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { dumpProviderInput } from './debug/dump';
import { classifyProviderRequest } from './routing/classifier';
import { VisionService } from './vision/service';

/** Cache TTL for model list (30 seconds). */
const MODEL_CACHE_TTL_MS = 30_000;

export class SavicLabsChatProvider implements vscode.LanguageModelChatProvider {
  private client: SavicLabsClient;
  private visionService: VisionService;
  private changeEmitter = new vscode.EventEmitter<void>();
  private isActive = true;
  private cachedModels: { models: vscode.LanguageModelChatInformation[]; timestamp: number } | undefined;
  private globalStorageUri: vscode.Uri;

  /** Adaptive chars-per-token ratio, calibrated from actual usage data. */
  private charsPerToken = 4.0;

  onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  constructor(context: vscode.ExtensionContext) {
    this.client = new SavicLabsClient(getBaseUrl());
    this.visionService = new VisionService(context);
    this.globalStorageUri = context.globalStorageUri;

    context.subscriptions.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('savicLabs.baseUrl') ||
          e.affectsConfiguration('savicLabs.modelIdOverrides')
        ) {
          this.client = new SavicLabsClient(getBaseUrl());
          this.invalidateCache();
          this.refreshModelPicker();
        }
      })
    );
  }

  // ---- Public commands ----

  async configureEndpoint(): Promise<void> {
    const currentUrl = getBaseUrl();
    const newUrl = await vscode.window.showInputBox({
      prompt: t('command.configureEndpoint.prompt'),
      placeHolder: t('command.configureEndpoint.placeholder'),
      value: currentUrl,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value?.trim()) {
          return t('command.configureEndpoint.empty');
        }
        try {
          new URL(value);
          return undefined;
        } catch {
          return 'Invalid URL format. Example: http://127.0.0.1:18080/v1';
        }
      },
    });

    if (newUrl) {
      const config = vscode.workspace.getConfiguration('savicLabs');
      await config.update('baseUrl', newUrl.trim(), vscode.ConfigurationTarget.Global);
      this.client = new SavicLabsClient(newUrl.trim());
      this.invalidateCache();
      this.refreshModelPicker();
      void vscode.window.showInformationMessage(t('command.configureEndpoint.saved'));
    }
  }

  async refreshModels(): Promise<void> {
    this.invalidateCache();
    this.refreshModelPicker();
    void vscode.window.showInformationMessage(t('models.refreshed'));
  }

  async setVisionModel(): Promise<void> {
    await this.visionService.openConfiguration();
  }

  /** Force Copilot Chat to re-query model information. */
  refreshModelPicker(): void {
    this.changeEmitter.fire();
  }

  invalidateCache(): void {
    this.cachedModels = undefined;
  }

  async prepareForDeactivate(): Promise<void> {
    this.isActive = false;
    this.changeEmitter.fire();
    try {
      await vscode.lm.selectChatModels({ vendor: 'SavicLabs' });
    } catch (error) {
      logger.warn('Failed to refresh models during deactivate', error);
    }
  }

  // ---- LanguageModelChatProvider implementation ----

  async provideLanguageModelChatInformation(
    options: { silent?: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (!this.isActive) {
      return [];
    }

    // Check cache
    const now = Date.now();
    if (this.cachedModels && (now - this.cachedModels.timestamp) < MODEL_CACHE_TTL_MS) {
      return this.cachedModels.models;
    }

    try {
      const discovered = await fetchModels(this.client, token);

      if (discovered.length === 0) {
        if (!options.silent) {
          void vscode.window.showWarningMessage(
            `${t('models.empty')} (${this.client.baseUrl})`
          );
        }
        logger.warn('No models discovered from endpoint');
        return [];
      }

      const models = discovered.map(toChatInfo);

      if (getDebugLoggingEnabled()) {
        logger.info(`Discovered ${models.length} models from ${this.client.baseUrl}`);
        for (const m of discovered) {
          logger.debug(`  ${m.displayName} (${m.id}) — ${m.detail}`);
        }
      }

      this.cachedModels = { models, timestamp: now };
      return models;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch models from server', error);

      if (!options.silent) {
        void vscode.window.showWarningMessage(
          `${t('server.unavailable')}\n\n${msg}`
        );
      }

      // Return cached models if available
      if (this.cachedModels) {
        return this.cachedModels.models;
      }

      return [];
    }
  }

  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Cast to extended progress type that supports LanguageModelThinkingPart at runtime
    const extendedProgress = progress as unknown as vscode.Progress<vscode.LanguageModelChatResponsePart>;
    const mutableMessages = messages as unknown as vscode.LanguageModelChatMessage[];
    const requestOptions = options as unknown as vscode.LanguageModelChatRequestOptions;

    // Image guard: check if model supports images directly
    const hasImages = messages.some((m) =>
      Array.from(m.content).some(
        (p) =>
          p instanceof vscode.LanguageModelDataPart &&
          p.mimeType.toLowerCase().startsWith('image/')
      )
    );

    if (hasImages && !modelInfo.capabilities?.imageInput) {
      // Will be handled by vision proxy in prepareChatRequest
    }

    // Classify request for logging
    const requestKind = classifyProviderRequest({
      messages: messages as unknown as { role: number; content: readonly { value?: string }[] }[],
      tools: requestOptions.tools ? [...requestOptions.tools] : undefined,
    });

    logger.info(
      `[${requestKind}] chat request model=${modelInfo.id} messages=${messages.length} tools=${requestOptions.tools?.length ?? 0}`
    );

    // Dump input if verbose mode
    await dumpProviderInput({
      globalStorageUri: this.globalStorageUri,
      segment: '',
      modelInfo,
      messages: mutableMessages,
      requestOptions,
      requestKind,
    });

    try {
      const prepared = await prepareChatRequest({
        modelInfo,
        messages: mutableMessages,
        options: requestOptions,
        token,
        getVisionDescriber: () => this.visionService.get(),
      });

      await streamChatCompletion({
        prepared,
        progress: extendedProgress,
        token,
        getCharsPerToken: () => this.charsPerToken,
        setCharsPerToken: (ratio: number) => {
          this.charsPerToken = ratio;
        },
      });
    } catch (error) {
      if (token.isCancellationRequested) {
        return;
      }
      const userError = createUserFacingError(error);
      logger.error(`[${requestKind}] Chat request failed`, error);
      throw userError;
    }
  }

  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const value = typeof text === 'string' ? text : getMessageText(text);
    return estimateTokenCount(value, this.charsPerToken);
  }
}

function getMessageText(message: vscode.LanguageModelChatMessage): string {
  let text = '';
  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      text += part.value;
    }
  }
  return text;
}
