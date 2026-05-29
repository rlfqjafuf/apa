const http = require('http');
const fs = require('fs');
const path = require('path');

// Render and local development share this single Node server.
// It serves the web files and exposes the backend API endpoints under /api.
const root = __dirname;
const MAX_JSON_BODY_BYTES = 64 * 1024;

loadEnvFile();

const port = Number(process.env.PORT || 4175);
const host = process.env.HOST || '0.0.0.0';
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const openAiTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 25000);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    setBaseHeaders(res);

    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
            setCorsHeaders(req, res);
            res.writeHead(204);
            res.end();
            return;
        }

        // Health check used by Render and local debugging.
        if (req.method === 'GET' && url.pathname === '/api/health') {
            sendJson(req, res, 200, {
                ok: true,
                service: 'nexis-backend',
                environment: process.env.NODE_ENV || 'development',
                openaiConfigured: hasUsableOpenAiKey(),
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Keeps the OpenAI API key on the server and returns hint-style answers.
        if (req.method === 'POST' && url.pathname === '/api/search') {
            await handleSearch(req, res);
            return;
        }

        if (url.pathname.startsWith('/api/')) {
            sendJson(req, res, 404, { error: 'API 경로를 찾을 수 없습니다.' });
            return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(req, res, 405, { error: '지원하지 않는 요청 방식입니다.' });
            return;
        }

        serveStatic(url.pathname, req, res);
    } catch (error) {
        console.error('Unhandled request error:', error);
        sendJson(req, res, 500, { error: '서버에서 요청을 처리하지 못했습니다.' });
    }
});

server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`Nexis backend: http://${displayHost}:${port}`);
});

// Loads .env during local development. Render injects these as environment variables.
function loadEnvFile() {
    const envPath = path.join(root, '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex === -1) continue;

        const key = trimmed.slice(0, equalsIndex).trim();
        const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
            process.env[key] = value;
        }
    }
}

// Adds lightweight browser security headers to every response.
function setBaseHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

// Optional CORS support for a separate frontend domain.
function setCorsHeaders(req, res) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
    const requestOrigin = req.headers.origin || '';

    if (!allowedOrigin) return;

    const allowedOrigins = allowedOrigin.split(',').map(origin => origin.trim()).filter(Boolean);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : requestOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
}

// Serves index.html, history.html, and other frontend assets from this folder.
function serveStatic(requestPath, req, res) {
    const normalizedPath = decodeURIComponent(requestPath === '/' ? '/index.html' : requestPath);
    const filePath = path.normalize(path.join(root, normalizedPath));
    const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

    if (filePath !== root && !filePath.startsWith(rootWithSeparator)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': process.env.NODE_ENV === 'production'
                ? 'public, max-age=300'
                : 'no-store'
        });

        if (req.method === 'HEAD') {
            res.end();
            return;
        }

        res.end(data);
    });
}

// Calls OpenAI Responses API and asks it to provide hints instead of final answers.
async function handleSearch(req, res) {
    if (!hasUsableOpenAiKey()) {
        sendJson(req, res, 500, {
            error: 'OPENAI_API_KEY가 설정되어 있지 않습니다. Render 환경 변수 또는 apa/.env에 API 키를 넣어 주세요.'
        });
        return;
    }

    let body;
    try {
        body = await readJsonBody(req);
    } catch (error) {
        const status = error.code === 'BODY_TOO_LARGE' ? 413 : 400;
        sendJson(req, res, status, { error: error.message });
        return;
    }

    const question = String(body.question || '').trim();
    const userName = String(body.userName || '사용자').trim();

    if (!question) {
        sendJson(req, res, 400, { error: '검색어를 입력해 주세요.' });
        return;
    }

    if (question.length > 2000) {
        sendJson(req, res, 400, { error: '검색어는 2,000자 이하로 입력해 주세요.' });
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), openAiTimeoutMs);

    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                input: [
                    {
                        role: 'developer',
                        content: [
                            'You are Nexis AI Assistant.',
                            'Respond in Korean.',
                            'Do not give the final answer directly.',
                            'Instead, help the user discover the answer by giving a short method, key concepts to check, and 2-4 actionable hints.',
                            'If the user asks for code, homework, quiz answers, calculations, or factual lookup, explain how to solve or verify it step by step without spoiling the final result.',
                            'Keep the tone encouraging and concise.'
                        ].join(' ')
                    },
                    {
                        role: 'user',
                        content: `사용자 이름: ${userName}\n검색어: ${question}`
                    }
                ]
            })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 401) {
                sendJson(req, res, 401, {
                    error: 'OpenAI API 키가 올바르지 않거나 만료되었습니다. 새 API 키로 교체해 주세요.'
                });
                return;
            }

            sendJson(req, res, response.status, {
                error: data.error?.message || 'OpenAI API 요청에 실패했습니다.'
            });
            return;
        }

        sendJson(req, res, 200, {
            answer: extractResponseText(data),
            mode: 'hint',
            model
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            sendJson(req, res, 504, { error: 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' });
            return;
        }

        console.error('OpenAI request failed:', error);
        sendJson(req, res, 502, { error: 'AI 서버와 통신하지 못했습니다.' });
    } finally {
        clearTimeout(timeout);
    }
}

// Rejects placeholder keys so the app fails with a clear setup message.
function hasUsableOpenAiKey() {
    const apiKey = process.env.OPENAI_API_KEY || '';
    return Boolean(apiKey && !apiKey.includes('your-api-key') && !apiKey.includes('sk-your'));
}

// Parses small JSON request bodies and rejects malformed or oversized payloads.
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        let settled = false;

        req.on('data', chunk => {
            if (settled) return;

            raw += chunk;
            if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BODY_BYTES) {
                const error = new Error('요청 본문이 너무 큽니다.');
                error.code = 'BODY_TOO_LARGE';
                settled = true;
                reject(error);
                req.destroy();
            }
        });

        req.on('end', () => {
            if (settled) return;
            settled = true;

            if (!raw) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error('JSON 형식이 올바르지 않습니다.'));
            }
        });

        req.on('error', error => {
            if (settled) return;
            if (error.code === 'ECONNRESET') return;
            settled = true;
            reject(error);
        });
    });
}

// Supports both Responses API output_text and nested output content shapes.
function extractResponseText(data) {
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const chunks = [];
    for (const item of data.output || []) {
        for (const content of item.content || []) {
            if (content.type === 'output_text' && content.text) {
                chunks.push(content.text);
            }
        }
    }

    return chunks.join('\n').trim() || '힌트를 생성하지 못했습니다.';
}

// Sends one JSON response and applies optional CORS headers.
function sendJson(req, res, status, payload) {
    setCorsHeaders(req, res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}
