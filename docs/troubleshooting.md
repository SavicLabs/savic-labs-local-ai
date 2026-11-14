# Troubleshooting

Start with **SavicLabs: Check Backend Health** and **SavicLabs: Show Logs**. Most
problems are a wrong endpoint, an unreachable server, or a model that failed to load,
and the log names which.

## No models appear in the picker

1. Confirm the endpoint responds:

   ```bash
   curl http://127.0.0.1:11434/v1/models
   ```

2. Check that the URL ends in `/v1` — it should not include `/chat/completions`.
3. Run **SavicLabs: Refresh Models**.
4. Check the log for `Failed to fetch models from <endpoint>`.

If one of several endpoints is down, the others still load; only the failing one is
skipped.

## "Cannot connect to …"

The request never reached the server. Verify the URL and that the server is listening on
that interface. A server bound to `127.0.0.1` cannot be reached from another machine —
bind it to `0.0.0.0` or the LAN address instead.

## "Server error (HTTP 500)"

The server accepted the request and failed while handling it. On llama.cpp this usually
means the model could not be loaded. Check the server's own log, restart it, then run
**SavicLabs: Refresh Models**.

## "Server unavailable (HTTP 503)"

The server is up but not ready. Wait for the model to finish loading and retry.
Transient 5xx responses and HTTP 429 are retried automatically with backoff; a 503 that
persists means the server is genuinely unavailable.

## "Model has failed to load"

The server reported `status: failed` for that model, typically insufficient memory.
Stop other models on the server or choose a smaller one, restart the router, and run
**SavicLabs: Refresh Models**. Retrying the same request will not succeed.

## Requests time out

Raise `savicLabs.requestTimeoutMs` for large models that need time to load. A stream
that stalls — more than 60 seconds without data once the first token has arrived, or
120 seconds before it — is aborted and reported rather than hanging indefinitely.

## Thinking output doesn't appear

Reasoning is enabled only for models detected as reasoning-capable. Detection uses the
model ID (Qwen-family names) and llama.cpp's `draft-mtp` speculative type. A reasoning
model with an unusual name may not be detected; if its server reports model metadata that
differs, check the log for the detected capability line.

## Images are rejected

The vision proxy needs a vision-capable model available to VS Code. Without one,
attachments cannot be described. Run **SavicLabs: Configure Vision Proxy** to pick a
specific model, or set `savicLabs.visionModel`.

## Responses are slow on the first request

A model that is not resident must be loaded before it can answer. The extension does not
poll for loading — the chat request itself triggers the load — so the first response
includes that load time. Subsequent requests are faster while the model stays resident.

## Cloud provider returns 401 or 403

The key is missing or wrong for that endpoint. Run **SavicLabs: Configure Backends** and
re-enter it. Keys are stored per endpoint, so a key entered for one provider is not used
for another.

## Diagnosing further

Set `savicLabs.debugMode` to `metadata` for request classification and token counts in
the log, or `verbose` to also write one metadata file per request. Dumps contain no
message content. **SavicLabs: Open Request Dumps Folder** opens the directory.

For issues that were fixed in earlier versions, see the [changelog](../CHANGELOG.md).

## API keys after upgrading to 0.10.10

0.10.10 moved API keys out of `settings.json` and into VS Code's SecretStorage.
On first activation any keys in `savicLabs.apiKeys` are copied across and the
setting is deleted, so there is nothing to re-enter.

**If a key is missing after upgrading**, the migration did not complete. Re-enter
it with **SavicLabs: Configure Backends**; it will be written to SecretStorage.

**To check whether migration happened**, open `settings.json` and search for
`savicLabs.apiKeys`. After a successful migration the entry is gone. The keys
are not visible in the Settings UI at all, because they no longer live there.

**Rotate the key** if the old `settings.json` was ever committed to a repository,
included in a backup, or synchronised with Settings Sync. Deleting the value from
your current settings does not remove it from those copies, nor from Git history.

**Commands that need to be re-run**: none. Endpoint configuration is unaffected —
only the keys move.
