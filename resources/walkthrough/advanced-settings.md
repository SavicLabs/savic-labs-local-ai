# Advanced Configuration

**Vision Proxy**: SavicLabs auto-detects images and describes them using an available Copilot vision model. Configure this via **SavicLabs: Configure Vision Proxy**.

**Model ID Overrides**: Map VS Code model IDs to different API model names in settings:
```json
"savicLabs.modelIdOverrides": {
  "my-model": "actual-api-model-name"
}
```

**Debug Mode**: Set `savicLabs.debugMode` to `verbose` to write full request dumps to disk for debugging.

**Tool Stabilization**: Enable `savicLabs.experimental.stabilizeToolList` to improve context-cache hit rates on API proxies.
