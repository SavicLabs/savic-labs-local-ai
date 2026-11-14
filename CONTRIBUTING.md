# Contributing

## Setup

```bash
npm ci
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.
`npm run watch` rebuilds on change.

## Checks

All of these must pass before a change is merged:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint
npm test            # compiles, then runs test/*.test.cjs
npm run package     # produces a .vsix, which CI also verifies
```

`npm test` does not require the extension host or network access. It compiles to `out/`
and runs the tests there against a stubbed `vscode` module
(`test/helpers/vscode.cjs`). Add a test when fixing a defect or changing behaviour that
the suite already covers — context estimation, model ID handling, token estimation,
JSON handling, or API key storage.

## Scope

- Preserve existing behaviour unless the change is a demonstrated fix.
- Do not add runtime dependencies. The extension builds on Node's `fetch` and VS Code's
  APIs; there is no SDK layer and no bundler.
- Keep provider-specific behaviour out of the request path where a generic
  OpenAI-compatible path will do.

## Commits and pull requests

Commits should say what changed and why, in the imperative mood. Keep unrelated changes
in separate commits.

Pull requests should state the problem, the approach, and how it was verified. If a claim
in the README or `docs/` no longer holds, update it in the same pull request.

## Publishing

Releases are cut by a maintainer by pushing a `v*` tag, which triggers
`.github/workflows/publish.yml`. Pull requests never publish. Do not bump the version in
a feature pull request; versioning is decided at release time.
