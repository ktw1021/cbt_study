import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const unit = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs')).sort();
const browser = [
  'run.mjs', 'account-switch.mjs', 'editor-browser.mjs', 'editor-linebreak.mjs',
  'editor-ux.mjs', 'align-footnote-ui.mjs', 'complex-editor-ui.mjs',
  'footnote-interaction.mjs', 'release-browser.mjs',
];
const suites = [['--test', ...unit.map(f => `tests/${f}`)]];
if (!process.argv.includes('--unit')) suites.push(...browser.map(f => [`tests/${f}`]));
// Sequential: some UI suites intentionally reuse a test port.
let failures = 0;
for (const args of suites) {
  console.log(`\nRunning node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    failures++;
    console.error(result.error || `Exit ${result.status}: ${args.join(' ')}`);
  }
}
console.log(`\n${suites.length - failures}/${suites.length} suites passed`);
process.exitCode = failures ? 1 : 0;
