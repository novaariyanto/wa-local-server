const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const logger = require('../logger');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const fs = require('fs');

/** Keadaan lifecycle client. Hanya satu instance aktif. */
const STATE = {
    IDLE: 'idle',
    STARTING: 'starting',
    QR: 'qr',
    AUTHENTICATING: 'authenticating',
    READY: 'ready',
    DISCONNECTING: 'disconnecting',
    DISCONNECTED: 'disconnected'
};

/** Backoff: base 2s, max 5 retries, cap 60s */
const INIT_RETRY_BASE_MS = 2000;
const INIT_RETRY_MAX_ATTEMPTS = 5;
const INIT_RETRY_CAP_MS = 60000;

class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        /** Hanya satu client aktif. Null hanya setelah stop() selesai. */
        this._client = null;
        this._ready = false;
        this._info = { number: null, name: null };
        this._state = STATE.IDLE;
        /** Retry backoff: attempt count dan timer handle */
        this._initRetryCount = 0;
        this._initRetryTimer = null;
        /** Flag agar listener hanya dipasang sekali per client instance (no duplicate) */
        this._listenersAttached = false;
    }

    get client() {
        return this._client;
    }

    get ready() {
        return this._ready;
    }

    get info() {
        return { ...this._info };
    }

    get state() {
        return this._state;
    }

    _setState(s) {
        if (this._state !== s) {
            this._state = s;
            logger.debug(`WA state: ${s}`);
        }
    }

    _clearRetry() {
        if (this._initRetryTimer) {
            clearTimeout(this._initRetryTimer);
            this._initRetryTimer = null;
        }
        this._initRetryCount = 0;
    }

    _scheduleRetry() {
        if (this._initRetryCount >= INIT_RETRY_MAX_ATTEMPTS) {
            logger.error('Max init retries reached. Stopping retries.');
            this._setState(STATE.DISCONNECTED);
            this.emit('disconnected', 'Initialization Failed (max retries)');
            return;
        }
        this._initRetryCount += 1;
        const delay = Math.min(
            INIT_RETRY_CAP_MS,
            INIT_RETRY_BASE_MS * Math.pow(2, this._initRetryCount - 1)
        );
        logger.info(`Scheduling init retry #${this._initRetryCount} in ${delay}ms`);
        this._setState(STATE.IDLE);
        this._initRetryTimer = setTimeout(() => {
            this._initRetryTimer = null;
            this.start();
        }, delay);
    }

    _attachListenersOnce() {
        if (!this._client || this._listenersAttached) return;
        this._listenersAttached = true;

        this._client.on('qr', (qr) => {
            this._setState(STATE.QR);
            logger.info('QR Code received');
            this.emit('qr', qr);
        });

        this._client.on('ready', () => {
            this._setState(STATE.READY);
            this._ready = true;
            this._clearRetry();
            try {
                this._info.number = this._client.info?.wid?.user ||
                    (this._client.info?.me?._serialized ? this._client.info.me._serialized.split('@')[0] : null) ||
                    'Unknown';
                this._info.name = this._client.info?.pushname || 'WhatsApp';
            } catch (err) {
                logger.warn('Failed to extract account info on ready:', err.message);
                this._info.number = this._info.number || 'Unknown';
                this._info.name = this._info.name || 'WhatsApp';
            }
            logger.info('WhatsApp Client is ready:', this._info.name, this._info.number);
            this.emit('ready', this.info);
        });

        this._client.on('authenticated', () => {
            this._setState(STATE.AUTHENTICATING);
            logger.info('WhatsApp Client authenticated (session restored)');
            this.emit('authenticated');
        });

        this._client.on('auth_failure', (msg) => {
            logger.error('Authentication failure', msg);
            this._ready = false;
            this._setState(STATE.DISCONNECTED);
            this.emit('auth_failure', msg);
        });

        this._client.on('disconnected', (reason) => {
            logger.warn('WhatsApp Client disconnected', reason);
            this._ready = false;
            this._setState(STATE.DISCONNECTED);
            this.emit('disconnected', reason);
            // Jangan set this._client = null di sini; biarkan stop() yang cleanup.
            // Ini mencegah client.destroy() dipanggil pada null.
        });

        this._client.on('loading_screen', (percent, message) => {
            logger.info(`WhatsApp Loading: ${percent}% - ${message}`);
            this.emit('loading_screen', { percent, message });
        });
    }

    start() {
        if (this._state === STATE.STARTING || this._state === STATE.READY) {
            logger.debug('Start ignored: already starting or ready');
            return;
        }
        if (this._client) {
            logger.debug('Start ignored: client already exists');
            return;
        }

        this._clearRetry();
        this._setState(STATE.STARTING);
        logger.info('Starting WhatsApp Client...');

        const userDataPath = app ? app.getPath('userData') : './';
        const sessionPath = path.join(userDataPath, 'wwebjs-auth');

        logger.info(`Session Path for LocalAuth: ${sessionPath}`);

        // Ensure directory exists, or clean if requested/corrupted
        try {
            if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
        } catch (err) {
            logger.error('Failed to create session directory. Attempting cleanup...', err.message);
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                fs.mkdirSync(sessionPath, { recursive: true });
            } catch (cleanupErr) {
                logger.error('Session Cleanup failed:', cleanupErr.message);
            }
        }

        const possiblePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ];

        let executablePath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                executablePath = p;
                logger.info(`Using browser: ${p}`);
                break;
            }
        }

        if (!executablePath) {
            logger.warn('No Chrome/Edge found, using Puppeteer Chromium');
        }

        try {
            this._client = new Client({
                authStrategy: new LocalAuth({
                    clientId: 'client-one',
                    dataPath: sessionPath
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--disable-features=IsolateOrigins,site-per-process',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-gpu-shader-disk-cache',
                        '--log-level=3',
                        '--no-default-browser-check',
                        '--disable-site-isolation-trials',
                        '--no-experiments',
                        '--ignore-gpu-blocklist',
                        '--ignore-certificate-errors',
                        '--ignore-certificate-errors-spki-list',
                        '--disable-extensions',
                        '--disable-default-apps',
                        '--enable-features=NetworkService',
                        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
                    ],
                    executablePath: executablePath
                }
            });
        } catch (err) {
            logger.error('Failed to create WhatsApp Client:', err.message);
            this._setState(STATE.DISCONNECTED);
            this._scheduleRetry();
            return;
        }

        this._listenersAttached = false;
        this._attachListenersOnce();

        this._client.initialize().catch((err) => {
            logger.error('Failed to initialize WhatsApp Client:', err.message);
            this._ready = false;
            this._setState(STATE.DISCONNECTED);
            this.emit('disconnected', 'Initialization Failed');
            this._safeDestroyClient();
            this._client = null;
            this._scheduleRetry();
        });
    }

    _safeDestroyClient() {
        const c = this._client;
        if (!c) return;
        try {
            if (c.pupBrowser) {
                c.pupBrowser.close().catch(() => { });
            }
        } catch (e) {
            logger.warn('Error closing pupBrowser:', e.message);
        }
        try {
            if (typeof c.destroy === 'function') {
                c.destroy();
            }
        } catch (e) {
            logger.warn('Error during client.destroy():', e.message);
        }
    }

    async stop() {
        this._clearRetry();
        this._setState(STATE.DISCONNECTING);
        this._ready = false;

        const c = this._client;
        this._client = null;
        this._listenersAttached = false;

        if (!c) {
            this._setState(STATE.IDLE);
            logger.info('WhatsApp Client already stopped');
            return;
        }

        let pid = null;
        try {
            if (c.pupBrowser) {
                const proc = c.pupBrowser.process && c.pupBrowser.process();
                if (proc) pid = proc.pid;
                await c.pupBrowser.close();
            }
        } catch (err) {
            logger.warn('Error closing browser:', err.message);
        }

        this._safeDestroyClient();

        if (pid) {
            try {
                process.kill(pid, 0);
                process.kill(pid, 'SIGKILL');
                logger.info('Force-killed browser process PID', pid);
            } catch (e) {
                // Process already gone
            }
        }

        this._setState(STATE.IDLE);
        logger.info('WhatsApp Client stopped');
    }

    async sendMessage(to, message) {
        if (!this._client || !this._ready) {
            throw new Error('WhatsApp client is not ready');
        }
        let chatId = to;
        if (!chatId.includes('@')) {
            chatId = `${to}@c.us`;
        }
        const response = await this._client.sendMessage(chatId, message);
        return response;
    }

    /** Cek siap kirim tanpa throw. Untuk endpoint API. */
    isReady() {
        return !!(this._client && this._ready);
    }

    getStatus() {
        return {
            ready: this._ready,
            state: this._state,
            info: this.info
        };
    }
}

module.exports = new WhatsAppService();
