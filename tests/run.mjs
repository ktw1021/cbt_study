import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { runNavigationTests, SHOT_MANAGE } from './navigation-ui.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.CBT_TEST_PORT || 4173);
const LOG = join(tmpdir(), 'cbt-nav-report.log');
const FINDINGS = join(tmpdir(), 'cbt-nav-findings.md');

const lines = [];
const log = (msg) => {
  lines.push(msg);
  console.log(msg);
};

async function main() {
  log('start');
  const server = createAppServer(ROOT, PORT);
  await listen(server, PORT);
  log(`listen ${PORT}`);
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable(),
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (err) => log(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log(`console.error: ${msg.text()}`);
  });
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const touchPage = await touchContext.newPage();
  touchPage.setDefaultTimeout(15000);
  log('browser ready');

  let failed = 0;
  try {
    const { results, findings } = await runNavigationTests({
      page,
      touchPage,
      planner: TEST_ALPHA_PLANNER,
    });
    for (const r of results) {
      if (r.ok) log(`OK ${r.name}`);
      else {
        failed += 1;
        log(`FAIL ${r.name}: ${r.message}`);
      }
    }
    const md = findings.length
      ? findings.map((f) => {
        const extra = f.extra ? `\n\n관측:\n\`\`\`json\n${JSON.stringify(f.extra, null, 2)}\n\`\`\`\n` : '';
        let fix = '앱 js (테스트는 앱을 고치지 않음). 빈칸 목록은 `js/ui/study-blank-nav.js`·`js/main.js`, 관리 포커스 드래그는 `js/ui/manage-selection.js`·`js/main.js` cardList 클릭·`dropCardOnFolder`.';
        if (String(f.name).includes('hover')) {
          fix = [
            '`css/layout.css` `.study-blank-nav-panel { display: flex }`가 HTML `hidden`의 `display:none`을 덮어, 닫힌 패널도 `visibility:visible; pointer-events:auto`로 히트된다. 수정: `[hidden] { display:none !important }` 또는 `.is-open`일 때만 flex.',
            '`js/ui/study-blank-nav.js` `mouseout`은 `relatedTarget`이 null이면 `scheduleClose`(220ms). Playwright/실제 포인터가 트리거 위에 남아도 mouseover가 다시 안 떠서 닫힌다. `root.matches(":hover")`이면 close 금지.',
            '`mouseover`의 `e.target.closest`는 Text 노드에서 예외. `mouseout`은 이미 `closest?.`다.',
            '`closeStudyBlankNav` 기본 `suppressHoverMs=320`, `focusBlankUI`는 400ms — 렌더 직후 hover를 삼킨다.',
          ].join(' ');
        }
        return `## ${f.name}\n\n- 재현: \`node tests/run.mjs\` 해당 시나리오\n- 원인(테스트가 본 것): ${f.message}${extra}\n- 수정 지점: ${fix}\n`;
      }).join('\n')
      : '실패 없음.\n';
    writeFileSync(FINDINGS, md, 'utf8');
  } catch (err) {
    failed += 1;
    log(`FAIL runner: ${err.message}`);
    writeFileSync(FINDINGS, `## runner\n\n${err.stack || err.message}\n\n로그:\n${lines.join('\n')}\n`, 'utf8');
  }

  await context.close();
  await touchContext.close();
  await browser.close();
  server.close();
  writeFileSync(LOG, `${lines.join('\n')}\nfindings: ${FINDINGS}\nshot: ${SHOT_MANAGE}\n`, 'utf8');
  log(`report: ${LOG}`);
  log(`findings: ${FINDINGS}`);
  log(`shot: ${SHOT_MANAGE}`);
  process.exit(failed ? 1 : 0);
}

main();
