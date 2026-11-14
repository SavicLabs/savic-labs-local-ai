'use strict';

/**
 * Minimal `vscode` module stub for tests.
 *
 * The extension imports `vscode` at module scope, which does not exist outside
 * the extension host. `install()` swaps the module resolver so `require('vscode')`
 * returns this stub. Call `install()` before requiring anything from ../out.
 */

const Module = require('node:module');

class MemorySecretStorage {
  constructor() {
    this.map = new Map();
    this.listeners = new Set();
  }
  onDidChange(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  async get(key) {
    return this.map.get(key);
  }
  async store(key, value) {
    this.map.set(key, value);
    this.emit(key);
  }
  async delete(key) {
    this.map.delete(key);
    this.emit(key);
  }
  emit(key) {
    for (const listener of this.listeners) listener({ key });
  }
}

class MemoryMemento {
  constructor() {
    this.map = new Map();
  }
  get(key, fallback) {
    return this.map.has(key) ? this.map.get(key) : fallback;
  }
  async update(key, value) {
    if (value === undefined) this.map.delete(key);
    else this.map.set(key, value);
  }
}

function createVscode(initialSettings = {}) {
  const settings = { ...initialSettings };

  const configuration = () => ({
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(settings, key);
    },
    async update(key, value) {
      if (value === undefined) delete settings[key];
      else settings[key] = value;
    },
    inspect: () => undefined,
  });

  const channel = { appendLine() {}, append() {}, show() {}, clear() {}, dispose() {} };

  return {
    __settings: settings,
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      getConfiguration: configuration,
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: {
      createOutputChannel: () => channel,
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      registerUriHandler: () => ({ dispose() {} }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async () => undefined,
    },
    Uri: {
      file: (fsPath) => ({ fsPath, scheme: 'file' }),
      joinPath: (base, ...parts) => ({ fsPath: [base.fsPath ?? base, ...parts].join('/') }),
    },
    ThemeIcon: class {
      constructor(id) {
        this.id = id;
      }
    },
    EventEmitter: class {
      constructor() {
        this.listeners = new Set();
        this.event = (listener) => {
          this.listeners.add(listener);
          return { dispose: () => this.listeners.delete(listener) };
        };
      }
      fire(value) {
        for (const listener of this.listeners) listener(value);
      }
      dispose() {
        this.listeners.clear();
      }
    },
    LanguageModelTextPart: class {
      constructor(value) {
        this.value = value;
      }
    },
    LanguageModelDataPart: class {
      constructor(data, mimeType) {
        this.data = data;
        this.mimeType = mimeType;
      }
    },
    LanguageModelToolCallPart: class {
      constructor(callId, name, input) {
        this.callId = callId;
        this.name = name;
        this.input = input;
      }
    },
    LanguageModelToolResultPart: class {
      constructor(callId, content) {
        this.callId = callId;
        this.content = content;
      }
    },
    LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 3 },
    lm: {
      selectChatModels: async () => [],
      registerLanguageModelChatProvider: () => ({ dispose() {} }),
    },
    env: { openExternal: async () => true },
  };
}

/** Redirect `require('vscode')` to the stub. Returns a restore function. */
function install(vscode) {
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return original.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = original;
  };
}

/** A stand-in for vscode.ExtensionContext, optionally sharing existing stores. */
function createExtensionContext(existing = {}) {
  return {
    secrets: existing.secrets ?? new MemorySecretStorage(),
    globalState: existing.globalState ?? new MemoryMemento(),
    subscriptions: [],
    globalStorageUri: { fsPath: '/tmp/saviclabs-test-storage' },
    extension: { packageJSON: { version: '0.0.0-test' } },
  };
}

module.exports = {
  createVscode,
  install,
  createExtensionContext,
  MemorySecretStorage,
  MemoryMemento,
};
