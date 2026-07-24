/**
 * Tool flow processing — preflight activation, drift notices, etc.
 */
import * as vscode from 'vscode';
import type { RequestKind } from '../routing/classifier';

export interface ToolFlowInput {
  stabilizeToolList: boolean;
  messages: vscode.LanguageModelChatMessage[];
  tools: vscode.LanguageModelChatTool[] | undefined;
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>;
  requestKind: RequestKind;
}

export interface ToolFlowResult {
  preflightHandled: boolean;
  messages: vscode.LanguageModelChatMessage[];
  initialResponseNotice?: string;
}

/**
 * Process tool flow for a request.
 * Currently implements stabilization and preflight checks.
 */
export function processToolFlow(input: ToolFlowInput): ToolFlowResult {
  // For now, pass through — full stabilization can be added later
  return {
    preflightHandled: false,
    messages: input.messages,
  };
}
