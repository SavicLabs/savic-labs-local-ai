# Security

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's
[security advisory](https://github.com/SavicLabs/savic-labs-local-ai/security/advisories/new)
form for this repository. Please do not open a public issue for a security problem.

Include what you did, what happened, and the extension version. A reply should be
expected within a few days; a fix and a coordinated disclosure date will be agreed
before anything is published.

## Supported versions

Only the latest published version receives security fixes.

## How credentials are handled

- API keys are stored in VS Code's SecretStorage, which is backed by the OS credential
  store where one is available. They are not written to `settings.json`, to logs, or to
  dump files.
- A key is looked up per endpoint and attached only to requests sent to that endpoint. It
  is never forwarded to a different host.
- Versions before the SecretStorage change stored keys in the `savicLabs.apiKeys`
  setting. Those entries are migrated on activation and the setting is deleted.

## Data handled by the extension

- **Prompts and responses** go directly from VS Code to the endpoint you configure. They
  are not sent to SavicLabs or any other third party.
- **Diagnostic dumps** (`savicLabs.debugMode: verbose`) contain request metadata only:
  timestamp, model ID, request kind, message count, and tool count. Message content is
  deliberately excluded.
- **Images**, when the vision proxy is in use, are sent to the VS Code language model
  chosen to describe them. They are not sent to the local endpoint as images.
- The extension contains **no telemetry** and makes no network requests other than to the
  endpoints you configure and to VS Code's language model API.

## Known limitations

- Plain `http://` endpoints are supported, because a model server commonly runs on
  loopback or a trusted LAN. Over such a connection the API key and prompt content travel
  unencrypted. Use TLS if the endpoint is not on a network you control.
- The extension trusts the configured endpoint. A malicious endpoint can return arbitrary
  content, including tool calls the model then executes in your workspace.
- API keys are stored by VS Code; the extension cannot make the underlying OS credential
  store more secure than it is.
