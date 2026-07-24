/**
 * Request classifier — identifies the type of request to optimize behavior.
 * Direct port of the DeepSeek V4 extension's classifier logic.
 */

import type { ChatCompletionRequest } from '../../client/core';

/** Request classification categories. */
export type RequestKind =
  | 'main-agent'
  | 'todo-tracker'
  | 'prompt-categorizer'
  | 'settings-resolver'
  | 'chat-title'
  | 'inline-progress-message'
  | 'git-branch-name'
  | 'git-commit-message'
  | 'rename-suggestions'
  | 'terminal-steering'
  | 'background'
  | 'unknown';

/** System prompt prefixes that identify helper request types. */
const TODO_TRACKER_PREFIX = 'You are a background task tracker';
const PROMPT_CATEGORIZER_PREFIX = 'You are an expert classifier for AI coding assistant prompts';
const SETTINGS_RESOLVER_PREFIX = 'You are a Visual Studio Code assistant. Your job is to assist users in using Visual Studio Code by returning settings';
const CHAT_TITLE_PREFIXES = [
  'You are an expert in crafting ultra-compact titles',
  'You are an expert in crafting pithy titles',
];
const INLINE_PROGRESS_MESSAGE_PREFIX = 'You are an expert in writing short, catchy, and encouraging progress messages';
const GIT_BRANCH_NAME_PREFIX = 'You are an expert in crafting pithy branch names';
const GIT_COMMIT_MESSAGE_PREFIX = 'You are an AI programming assistant, helping a software developer to come with the best git commit message';
const RENAME_SUGGESTIONS_PREFIX = 'You are a distinguished software engineer';
const MAIN_AGENT_PREFIX = 'You are an expert AI programming assistant';
const TERMINAL_NOTIFICATION_PATTERN = /^\[Terminal\s+\S+\s+notification:/;

/** Request kinds where thinking is forced to disabled (trivial tasks). */
const REQUEST_KINDS_WITH_FORCED_NONE_THINKING: Set<string> = new Set([
  'todo-tracker',
  'prompt-categorizer',
  'settings-resolver',
  'chat-title',
  'inline-progress-message',
  'git-branch-name',
  'git-commit-message',
  'rename-suggestions',
]);

export interface ProviderRequestInput {
  messages: { role: number; content: readonly { value?: string }[] }[];
  tools?: { name: string }[];
}

export interface DeepSeekRequestInput {
  request: ChatCompletionRequest;
  inputMessages?: { role: number; content: readonly { value?: string }[] }[];
}

export function formatModelFields(vscodeModelId: string, apiModelId?: string): string {
  const apiField = apiModelId && apiModelId !== vscodeModelId ? ` apiModel=${apiModelId}` : '';
  return `model=${vscodeModelId}${apiField}`;
}

export function formatRequestLogLine(requestKind: string, message: string): string {
  return `[${requestKind}] ${message}`;
}

export function shouldForceThinkingNone(requestKind: string): boolean {
  return REQUEST_KINDS_WITH_FORCED_NONE_THINKING.has(requestKind);
}

export function classifyProviderRequest(input: ProviderRequestInput): RequestKind {
  return classifyRequest({
    firstText: getFirstVscodeText(input.messages),
    latestUserText: getLatestVscodeUserText(input.messages),
    toolNames: input.tools?.map((tool) => tool.name) ?? [],
  });
}

export function classifyDeepSeekRequest(input: DeepSeekRequestInput): RequestKind {
  const messages = input.request.messages as { role: string; content: string }[] | undefined;
  return classifyRequest({
    firstText:
      messages?.[0]?.content ??
      (input.inputMessages ? getFirstVscodeText(input.inputMessages) : ''),
    latestUserText:
      (input.inputMessages ? getLatestVscodeUserText(input.inputMessages) : '') ||
      getLatestDeepSeekUserText(input.request),
    toolNames: input.request.tools?.map((tool: unknown) => {
      const fn = (tool as Record<string, unknown>).function as Record<string, unknown> | undefined;
      return String(fn?.name ?? '');
    }) ?? [],
  });
}

interface ClassifyInput {
  firstText: string;
  latestUserText: string;
  toolNames: string[];
}

function classifyRequest(input: ClassifyInput): RequestKind {
  const firstText = input.firstText.trimStart();
  const latestUserText = input.latestUserText.trimStart();

  if (TERMINAL_NOTIFICATION_PATTERN.test(latestUserText)) {
    return 'terminal-steering';
  }

  if (
    isOnlyTool(input.toolNames, 'manage_todo_list') ||
    firstText.startsWith(TODO_TRACKER_PREFIX)
  ) {
    return 'todo-tracker';
  }

  if (
    isOnlyTool(input.toolNames, 'categorize_prompt') ||
    firstText.startsWith(PROMPT_CATEGORIZER_PREFIX)
  ) {
    return 'prompt-categorizer';
  }

  if (firstText.startsWith(SETTINGS_RESOLVER_PREFIX)) {
    return 'settings-resolver';
  }

  if (startsWithAny(firstText, CHAT_TITLE_PREFIXES)) {
    return 'chat-title';
  }

  if (firstText.startsWith(INLINE_PROGRESS_MESSAGE_PREFIX)) {
    return 'inline-progress-message';
  }

  if (firstText.startsWith(GIT_BRANCH_NAME_PREFIX)) {
    return 'git-branch-name';
  }

  if (firstText.startsWith(GIT_COMMIT_MESSAGE_PREFIX)) {
    return 'git-commit-message';
  }

  if (firstText.startsWith(RENAME_SUGGESTIONS_PREFIX)) {
    return 'rename-suggestions';
  }

  if (
    firstText.startsWith(MAIN_AGENT_PREFIX) ||
    firstText.includes('<skills>') ||
    firstText.includes('<agents>')
  ) {
    return 'main-agent';
  }

  if (input.toolNames.length > 0 || firstText.length > 0) {
    return 'background';
  }

  return 'unknown';
}

function isOnlyTool(toolNames: string[], toolName: string): boolean {
  return toolNames.length === 1 && toolNames[0] === toolName;
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

function getDeepSeekToolName(tool: Record<string, unknown>): string {
  const fn = tool.function as Record<string, unknown> | undefined;
  return String(fn?.name ?? '');
}

function getFirstVscodeText(
  messages: { role: number; content: readonly { value?: string }[] }[]
): string {
  const firstMessage = messages[0];
  if (!firstMessage) {
    return '';
  }
  return getVscodeMessageText(firstMessage);
}

function getLatestVscodeUserText(
  messages: { role: number; content: readonly { value?: string }[] }[]
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    // User role is typically 1
    if (message.role === 1) {
      return getVscodeMessageText(message);
    }
  }
  return '';
}

function getVscodeMessageText(message: { content: readonly { value?: string }[] }): string {
  let text = '';
  for (const part of message.content) {
    if (typeof part.value === 'string') {
      text += part.value;
    }
  }
  return text;
}

function getLatestDeepSeekUserText(request: ChatCompletionRequest): string {
  const messages = request.messages as { role: string; content: string }[] | undefined;
  if (!messages) {
    return '';
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].content;
    }
  }
  return '';
}
