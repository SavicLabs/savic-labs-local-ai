/**
 * Simple localization helper.
 * Returns the key itself if no translation is found (English-only for now).
 */

const en: Record<string, string> = {
  'extension.activateFailed': 'Failed to activate SavicLabs extension. Check the output log for details.',
  'extension.deactivateFailed': 'Failed to deactivate SavicLabs extension cleanly.',
  'extension.welcomeFailed': 'Failed to show SavicLabs welcome walkthrough.',
  'command.configureEndpoint.title': 'SavicLabs: Configure Endpoint',
  'command.configureEndpoint.prompt': 'Enter the base URL of your OpenAI-compatible API endpoint',
  'command.configureEndpoint.placeholder': 'http://127.0.0.1:18080/v1',
  'command.configureEndpoint.saved': 'SavicLabs endpoint URL saved.',
  'command.configureEndpoint.empty': 'URL cannot be empty.',
  'server.unavailable': 'Cannot connect to the SavicLabs server. Make sure your llama.cpp router is running.',
  'server.unavailable.detail': 'Server unavailable',
  'server.error': 'Server returned an error',
  'server.timeout': 'Request timed out',
  'server.cancelled': 'Request was cancelled',
  'models.fetchFailed': 'Failed to fetch models from server.',
  'models.empty': 'No models found. Make sure your llama.cpp router has models configured.',
  'models.refreshed': 'SavicLabs models refreshed.',
  'vision.noModel': 'No vision-capable model available for image description.',
  'vision.configured': 'Vision proxy model configured.',
  'vision.describing': 'Images described by {model}',
  'status.thinking': 'Reasoning Effort',
  'thinking.none': 'Disabled',
  'thinking.high': 'High',
  'thinking.max': 'Maximum',
  'thinking.none.desc': 'No reasoning — fastest responses',
  'thinking.high.desc': 'Standard reasoning depth',
  'thinking.max.desc': 'Maximum reasoning depth — slowest but most thorough',
  'image.notSupported': 'This model does not support image input. Configure a vision proxy model or use a multimodal model.',
};

export function t(key: string, params?: Record<string, string>): string {
  let text = en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
