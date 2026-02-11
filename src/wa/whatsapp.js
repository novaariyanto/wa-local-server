const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const logger = require('../logger');
const path = require('path');
const { app } = require('electron'); // For getting user data path
const fs = require('fs');

class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.ready = false;
        this.info = { number: null, name: null };
    }

    start() {
        if (this.client) return;

        logger.info('Starting WhatsApp Client...');

        // Use a persistent data path
        const userDataPath = app ? app.getPath('userData') : './';
        const sessionPath = path.join(userDataPath, '.wwebjs_auth');

        // Logic to detect Chrome/Edge to avoid downloading Chromium
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
                logger.info(`Found browser at ${p}`);
                break;
            }
        }

        if (!executablePath) {
            logger.warn('No Chrome/Edge found, using default Puppeteer Chromium (if downloaded)');
        }

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'client-one',
                dataPath: sessionPath
            }),
            puppeteer: {
                headless: true, // or false for debugging
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                executablePath: executablePath // Will be null if not found, falling back to bundled
            }
        });

        this.client.on('qr', (qr) => {
            logger.info('QR Code received');
            logger.debug(`QR Code length: ${qr ? qr.length : 0} characters`);
            logger.debug(`QR Code preview: ${qr ? qr.substring(0, 50) + '...' : 'null'}`);
            this.emit('qr', qr);
        });

        this.client.on('ready', () => {
            logger.info('WhatsApp Client is ready!');
            this.ready = true;
            this.info.number = this.client.info.wid.user;
            this.info.name = this.client.info.pushname;
            this.emit('ready', this.info);
        });

        this.client.on('authenticated', () => {
            logger.info('WhatsApp Client authenticated');
            this.emit('authenticated');
        });

        this.client.on('auth_failure', (msg) => {
            logger.error('Authentication failure', msg);
            this.emit('auth_failure', msg);
        });

        this.client.on('disconnected', (reason) => {
            logger.warn('WhatsApp Client disconnected', reason);
            this.ready = false;
            this.client = null;
            this.emit('disconnected', reason);
            // Optional: Auto reconnect logic could be here or handled by Main
        });

        this.client.initialize();
    }

    async stop() {
        if (this.client) {
            await this.client.destroy();
            this.client = null;
            this.ready = false;
            logger.info('WhatsApp Client stopped');
        }
    }

    async sendMessage(to, message) {
        if (!this.client || !this.ready) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            // Format number: '62812345678@c.us'
            let chatId = to;
            if (!chatId.includes('@')) {
                chatId = `${to}@c.us`;
            }

            const response = await this.client.sendMessage(chatId, message);
            return response;
        } catch (error) {
            logger.error('Failed to send message:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            ready: this.ready,
            info: this.info
        };
    }
}

module.exports = new WhatsAppService();
