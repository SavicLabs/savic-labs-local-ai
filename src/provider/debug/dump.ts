/**
 * Debug diagnostics recording and request dumps.
 */
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../../logger';
import { getRequestDumpEnabled } from '../../config';
import { safeStringify } from '../../json';

/**
 * Dump the full provider input to disk when verbose debug mode is enabled.
 */
export async function dumpProviderInput(params: {
  globalStorageUri: vscode.Uri;
  segment: string;
  modelInfo: vscode.LanguageModelChatInformation;
  messages: vscode.LanguageModelChatMessage[];
  requestOptions: vscode.LanguageModelChatRequestOptions;
  requestKind: string;
}): Promise<void> {
  if (!getRequestDumpEnabled()) {
    return;
  }

  const { globalStorageUri, segment, modelInfo, requestKind } = params;

  try {
    const dumpsDir = vscode.Uri.joinPath(globalStorageUri, 'dumps');
    await fs.mkdir(dumpsDir.fsPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Sanitize model ID for filename safety (/ and : are illegal on Windows)
    const safeModelId = modelInfo.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${timestamp}_${requestKind}_${segment}_${safeModelId}.json`;
    const filePath = path.join(dumpsDir.fsPath, filename);

    const dumpData = {
      timestamp: new Date().toISOString(),
      modelId: modelInfo.id,
      requestKind,
      segment,
      // Note: we don't dump full messages to avoid privacy issues
      messageCount: params.messages.length,
      toolCount: params.requestOptions.tools?.length ?? 0,
    };

    await fs.writeFile(filePath, safeStringify(dumpData, 2));
    logger.debug(`Request dump written to ${filePath}`);
  } catch (error) {
    logger.warn('Failed to write request dump', error);
  }
}

/**
 * Open the dumps folder in the OS file manager.
 */
export async function openRequestDumpsFolder(
  globalStorageUri: vscode.Uri
): Promise<void> {
  const dumpsDir = vscode.Uri.joinPath(globalStorageUri, 'dumps');
  await fs.mkdir(dumpsDir.fsPath, { recursive: true });
  await vscode.env.openExternal(vscode.Uri.file(dumpsDir.fsPath));
}
