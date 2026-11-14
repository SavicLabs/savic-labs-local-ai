const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index.js');
  const workspace = path.resolve(__dirname, 'fixture');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-extensions', '--no-sandbox', '--disable-gpu'],
  });
}

main().catch((error) => {
  console.error('Extension host tests failed:', error);
  process.exit(1);
});
