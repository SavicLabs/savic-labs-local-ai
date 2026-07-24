/**
 * Type augmentations for proposed VS Code APIs not yet in stable @types/vscode.
 *
 * These types are available at runtime in VS Code >= 1.116 but the
 * official TypeScript declarations haven't caught up yet.
 */

declare module 'vscode' {
  /**
   * A thinking/reasoning part in a language model response.
   * Used by models that support chain-of-thought reasoning.
   */
  export class LanguageModelThinkingPart {
    /** The reasoning text content. */
    value: string | string[];

    /**
     * @param value The reasoning text content.
     */
    constructor(value: string | string[]);
  }

  /**
   * Union type of all possible language model chat response parts.
   */
  export type LanguageModelChatResponsePart =
    | LanguageModelTextPart
    | LanguageModelToolCallPart
    | LanguageModelThinkingPart
    | LanguageModelDataPart;

  /**
   * Configuration schema for a language model's optional settings.
   * Shown in the Copilot Chat model picker as a dropdown/settings UI.
   */
  export interface LanguageModelChatConfigurationSchema {
    properties: Record<
      string,
      {
        type: string;
        title: string;
        enum?: string[];
        enumItemLabels?: string[];
        enumDescriptions?: string[];
        default?: string;
        group?: string;
      }
    >;
  }

  /**
   * Extended capabilities for LanguageModelChatInformation.
   */
  export interface LanguageModelChatCapabilities {
    /** Number of tool calls supported (0 = none, positive = max count). */
    toolCalling?: number;
    /** Whether the model supports image input. */
    imageInput?: boolean;
    /** Whether the model supports thinking/reasoning. */
    thinking?: boolean;
  }

  /**
   * Extended LanguageModelChatInformation with proposed fields.
   */
  export interface LanguageModelChatInformation {
    /** Unique identifier for the model. */
    id: string;
    /** Display name. */
    name: string;
    /** Model family/vendor group. */
    family: string;
    /** Model version string. */
    version: string;
    /** Detailed description shown in the picker. */
    detail?: string;
    /** Maximum input tokens. */
    maxInputTokens: number;
    /** Maximum output tokens. */
    maxOutputTokens: number;
    /** Whether the model is user-selectable in the picker. */
    isUserSelectable?: boolean;
    /** Whether this is a bring-your-own-key model. */
    isBYOK?: boolean;
    /** Status icon for the model entry. */
    statusIcon?: ThemeIcon;
    /** Tooltip text. */
    tooltip?: string;
    /** Model capabilities. */
    capabilities?: LanguageModelChatCapabilities;
    /** Optional configuration schema for model settings. */
    configurationSchema?: LanguageModelChatConfigurationSchema;
    /** Optional pricing/cost information. */
    cost?: unknown;
  }

  /**
   * Model configuration options passed within a chat request.
   */
  export interface LanguageModelChatModelConfiguration {
    reasoningEffort?: string;
  }

  /**
   * Extended LanguageModelChatRequestOptions with model configuration.
   */
  export interface LanguageModelChatRequestOptions {
    /** Justification string. */
    justification?: string;
    /** Model-specific configuration. */
    modelConfiguration?: LanguageModelChatModelConfiguration;
    /** Tools available to the model. */
    tools?: readonly LanguageModelChatTool[];
    /** Tool calling mode. */
    toolMode?: LanguageModelChatToolMode;
    /** Raw model options. */
    modelOptions?: Record<string, unknown>;
  }

  /** Alias for LanguageModelChatInformation (VS Code uses both names). */
  export type LanguageModelChatModelInformation = LanguageModelChatInformation;
}
