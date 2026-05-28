const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;

loadEnvFile();

const port = Number(process.env.PORT || 4175);
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (req.method === 'POST' && url.pathname === '/api/search') {
            await handleSearch(req, res);
            return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { error: '지원하지 않는 요청입니다.' });
            return;
        }

        serveStatic(url.pathname, res);
    } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: '서버에서 요청을 처리하지 못했습니다.' });
    }
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Nexis app: http://127.0.0.1:${port}`);
});

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

function serveStatic(requestPath, res) {
    const normalizedPath = decodeURIComponent(requestPath === '/' ? '/index.html' : requestPath);
    const filePath = path.normalize(path.join(root, normalizedPath));

    if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

async function handleSearch(req, res) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        sendJson(res, 500, {
            error: 'OPENAI_API_KEY가 설정되어 있지 않습니다. apa/.env 파일에 API 키를 넣고 서버를 다시 실행해 주세요.'
        });
        return;
    }

    const body = await readJsonBody(req);
    const question = String(body.question || '').trim();
    const userName = String(body.userName || '사용자').trim();

    if (!question) {
        sendJson(res, 400, { error: '검색어를 입력해 주세요.' });
        return;
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
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
                        'If the request is about their local Nexis account or app state, explain what to inspect and where to find it based only on the provided context.',
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

    const data = await response.json();

    if (!response.ok) {
        sendJson(res, response.status, {
            error: data.error?.message || 'OpenAI API 요청에 실패했습니다.'
        });
        return;
    }

    sendJson(res, 200, {
        answer: extractResponseText(data),
        model
    });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 64 * 1024) {
                req.destroy();
                reject(new Error('Request body too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

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

    return chunks.join('\n').trim() || '답변을 생성하지 못했습니다.';
}

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}
