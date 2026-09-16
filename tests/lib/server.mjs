import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

/** 테스트 전용 env.alph — 저장소 env.alph 파일을 읽지 않음 */
export const TEST_ALPHA_PLANNER = 'cbt-e2e-alpha-planner-v1';
const FAKE_ENV_ALPH = `PRODUCT_PLANNER=${TEST_ALPHA_PLANNER}\n`;

export function createAppServer(root, port = 4173) {
  return createServer((req, res) => {
    let path = req.url?.split('?')[0] || '/';
    if (path === '/env.alph' || path === './env.alph') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(FAKE_ENV_ALPH);
      return;
    }
    if (path === '/') path = '/index.html';
    const file = join(root, path.replace(/^\//, ''));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
}

export function listen(server, port) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}
