import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const DEFAULT_NODE_MODULES = join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');

export function resolvePlaywrightCore() {
  const roots = [
    process.env.CBT_PLAYWRIGHT_CORE,
    process.env.PLAYWRIGHT_NODE_MODULES && join(process.env.PLAYWRIGHT_NODE_MODULES, 'playwright-core'),
    process.env.CODEX_NODE_MODULES && join(process.env.CODEX_NODE_MODULES, 'playwright-core'),
    join(process.env.CBT_NODE_MODULES || DEFAULT_NODE_MODULES, 'playwright-core'),
  ].filter(Boolean);
  for (const dir of roots) {
    const entry = join(dir, 'index.mjs');
    if (existsSync(entry)) return entry;
  }
  throw new Error('playwright-core not found — set CBT_PLAYWRIGHT_CORE or CBT_NODE_MODULES');
}

export async function loadChromium() {
  const entry = resolvePlaywrightCore();
  const mod = await import(pathToFileURL(entry).href);
  return mod.chromium;
}

export function browserExecutable() {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.env.CBT_BROWSER_EXE && existsSync(process.env.CBT_BROWSER_EXE)) {
    return process.env.CBT_BROWSER_EXE;
  }
  if (existsSync(edge)) return edge;
  if (existsSync(chrome)) return chrome;
  return undefined;
}
