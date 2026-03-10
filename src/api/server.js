const http = require('http');
const logger = require('../logger');

const SEND_TEXT_TIMEOUT_MS = 15000;

/**
 * HTTP API server untuk Laravel / client eksternal.
 * - GET /health -> readiness & WA status
 * - POST /api/v1/send-text -> kirim teks (return cepat jika tidak ready)
 */
function createApiServer(waService, getUptime) {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        const method = req.method;

        const send = (statusCode, body) => {
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        const sendError = (statusCode, message) => {
            send(statusCode, { success: false, error: message });
        };

        // GET /health
        if (method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
            const status = waService.getStatus();
            const uptime = typeof getUptime === 'function' ? getUptime() : 0;
            return send(200, {
                status: status.ready ? 'ok' : 'degraded',
                wa: {
                    ready: status.ready,
                    state: status.state,
                    number: status.info?.number || null,
                    name: status.info?.name || null
                },
                uptime_seconds: Math.floor(uptime)
            });
        }

        // POST /api/v1/send-text
        if (method === 'POST' && pathname === '/api/v1/send-text') {
            if (!waService.isReady()) {
                return sendError(503, 'WhatsApp client is not ready');
            }
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                let data;
                try {
                    data = body ? JSON.parse(body) : {};
                } catch (e) {
                    return sendError(400, 'Invalid JSON body');
                }
                const to = data.to || data.number;
                const message = data.message || data.text;
                if (!to || message === undefined) {
                    return sendError(400, 'Missing "to" or "message"');
                }
                let responded = false;
                const maybeSend = (statusCode, body) => {
                    if (responded) return;
                    responded = true;
                    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(body));
                };
                const timeout = setTimeout(() => {
                    maybeSend(504, { success: false, error: 'Send message timeout' });
                }, SEND_TEXT_TIMEOUT_MS);
                waService.sendMessage(to, String(message))
                    .then((result) => {
                        clearTimeout(timeout);
                        maybeSend(200, {
                            success: true,
                            id: result?.id?._serialized || result?.id
                        });
                    })
                    .catch((err) => {
                        clearTimeout(timeout);
                        logger.error('send-text error:', err.message);
                        maybeSend(500, { success: false, error: err.message || 'Send failed' });
                    });
            });
            return;
        }

        send(404, { error: 'Not found' });
    });

    return server;
}

module.exports = { createApiServer };
