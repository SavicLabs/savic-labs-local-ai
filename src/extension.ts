/**
 * SavicLabs Local AI for Copilot Chat — extension entry point.
 *
 * Registers the SavicLabs language model provider so local llama.cpp
 * models appear in the Copilot Chat model picker.
 */
import * as vscode from 'vscode';
import { logger } from './logger';
import { t } from './i18n';
import { SavicLabsChatProvider } from './provider';
import { openRequestDumpsFolder } from './provider/debug/dump';

let activeProvider: SavicLabsChatProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info(`SavicLabs extension activating v${context.extension.packageJSON.version}`);

  try {
    const provider = new SavicLabsChatProvider(context);
    activeProvider = provider;

    // Register as a language model chat provider — this is what makes
    // "SavicLabs" appear in the Copilot Chat model picker.
    context.subscriptions.push(
      vscode.lm.registerLanguageModelChatProvider(
        'SavicLabs',
        provider as vscode.LanguageModelChatProvider
      )
    );

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('savicLabs.configureEndpoint', () =>
        provider.configureEndpoint()
      ),
      vscode.commands.registerCommand('savicLabs.refreshModels', () =>
        provider.refreshModels()
      ),
      vscode.commands.registerCommand('savicLabs.setVisionModel', () =>
        provider.setVisionModel()
      ),
      vscode.commands.registerCommand('savicLabs.showLogs', () => {
        // The output channel is already created — reveal it
        void vscode.commands.executeCommand(
          'workbench.action.output.show',
          'SavicLabs'
        );
      }),
      vscode.commands.registerCommand('savicLabs.openRequestDumpsFolder', () =>
        openRequestDumpsFolder(context.globalStorageUri)
      )
    );

    // Handle URI actions
    context.subscriptions.push(
      vscode.window.registerUriHandler({
        handleUri(uri: vscode.Uri) {
          switch (uri.path) {
            case '/setEndpoint':
              void provider.configureEndpoint();
              break;
            case '/setVisionModel':
              void provider.setVisionModel();
              break;
            case '/showLogs':
              void vscode.commands.executeCommand(
                'workbench.action.output.show',
                'SavicLabs'
              );
              break;
          }
        },
      })
    );

    logger.info(
      `SavicLabs extension activated — endpoint: ${vscode.workspace.getConfiguration('savicLabs').get('baseUrl')}`
    );
  } catch (error) {
    activeProvider = undefined;
    logger.error('Failed to activate SavicLabs extension', error);
    void vscode.window.showErrorMessage(t('extension.activateFailed'));
    throw error;
  }
}

export async function deactivate(): Promise<void> {
  try {
    await activeProvider?.prepareForDeactivate();
  } catch (error) {
    logger.warn(t('extension.deactivateFailed'), error);
  } finally {
    activeProvider = undefined;
    logger.info('SavicLabs extension deactivated');
    logger.dispose();
  }
}
