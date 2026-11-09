/**
 * Logger wrapping VS Code OutputChannel for structured diagnostic output.
 */
import * as vscode from 'vscode';

const CHANNEL_NAME = 'SavicLabs';

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

function formatMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return `[${timestamp}] [${level}] ${message}`;
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('INFO', message);
    getChannel().appendLine(formatted);
    if (args.length > 0) {
      getChannel().appendLine(
        args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' ')
      );
    }
  },

  warn(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('WARN', message);
    getChannel().appendLine(formatted);
    if (args.length > 0) {
      getChannel().appendLine(
        args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' ')
      );
    }
  },

  error(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('ERROR', message);
    getChannel().appendLine(formatted);
    if (args.length > 0) {
      getChannel().appendLine(
        args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' ')
      );
    }
  },

  debug(message: string, ...args: unknown[]): void {
    const formatted = formatMessage('DEBUG', message);
    getChannel().appendLine(formatted);
    if (args.length > 0) {
      getChannel().appendLine(
        args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' ')
      );
    }
  },

  dispose(): void {
    if (channel) {
      channel.dispose();
      channel = undefined;
    }
  },
};
