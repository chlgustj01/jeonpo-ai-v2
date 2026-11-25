// Zero-dependency local dev server for testing this project without the
// Vercel CLI (which requires an account login to run `vercel dev`).
//
// Serves index.html as a static file and routes POST /api/analyze-menu to
// the same serverless function used in production, so the whole app can be
// exercised locally exactly as it behaves on Vercel.
//
// Usage:
//   GEMINI_API_KEY=your_key node dev-server.js
//   (or put GEMINI_API_KEY=your_key in a .env file next to this script)
//
// Then open http://localhost:3000 in a browser.

const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency) so GEMINI_API_KEY can live in a file
// instead of being typed on the command line every time.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] || '').replace(/^["']|["']$/g, '');
    }
  });
}

const analyzeMenuHandler = require('./api/analyze-menu.js');
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/analyze-menu') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        req.body = body ? JSON.parse(body) : {};
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      try {
        await analyzeMenuHandler(req, res);
      } catch (err) {
        console.error('Handler error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('index.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // [IMP-11] Vercel은 프로젝트 루트의 모든 파일(shared/allergens.js 포함)을
  // 별도 설정 없이 그대로 정적 파일로 서빙한다. 이 로컬 dev-server.js는 원래
  // index.html 하나와 /api/analyze-menu만 알고 있었는데, IMP-11에서
  // index.html이 <script src="shared/allergens.js">로 또 다른 파일을 불러오게
  // 되면서 그 경로도 로컬에서 서빙해야 Vercel과 동작이 같아진다. 이 분기가
  // 없으면 로컬에서는 이 파일이 항상 404가 되어, 매번 "shared 데이터 로드
  // 실패(fail-closed)" 경로만 타게 되는 상태로 테스트하게 된다 — 실제 배포
  // 환경과 다른 상태라 혼란스러운 버그처럼 보일 수 있다.
  // 보안: path.normalize로 "..".을 포함한 경로 탈출을 막고, 프로젝트 루트
  // 밖의 파일은 절대 서빙하지 않는다.
  if (req.method === 'GET') {
    const STATIC_CONTENT_TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };
    const requestedPath = decodeURIComponent((req.url.split('?')[0]) || '');
    const resolvedPath = path.normalize(path.join(__dirname, requestedPath));
    const ext = path.extname(resolvedPath);

    if (resolvedPath.startsWith(__dirname) && STATIC_CONTENT_TYPES[ext]) {
      fs.readFile(resolvedPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': STATIC_CONTENT_TYPES[ext] });
        res.end(data);
      });
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log(process.env.GEMINI_API_KEY
    ? 'GEMINI_API_KEY is set — AI menu scan will work.'
    : 'GEMINI_API_KEY is NOT set — AI menu scan will return a config error until you set it.');
});
