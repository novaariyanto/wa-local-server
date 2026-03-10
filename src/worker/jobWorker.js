const apiClient = require('../api/client');
const waService = require('../wa/whatsapp');
const logger = require('../logger');
const store = require('../config/store');
const EventEmitter = require('events');

class JobWorker extends EventEmitter {
    constructor() {
        super();
        this.running = false;
        this.timer = null;

        // Interval: UI (polling_interval) > server (poll_ms) > default 5000
        const pollMs = store.get('poll_ms');
        const uiInterval = store.get('polling_interval');
        const interval = (uiInterval && uiInterval > 0) ? uiInterval : (pollMs && pollMs > 0 ? pollMs : 5000);

        this.config = {
            enabled: store.get('polling_enabled') !== undefined ? store.get('polling_enabled') : true,
            interval,
            scheme: store.get('polling_scheme') || 'smart'
        };
    }

    getIntervalMs() {
        const uiInterval = store.get('polling_interval');
        const pollMs = store.get('poll_ms');
        return (uiInterval && uiInterval > 0) ? uiInterval : (pollMs && pollMs > 0 ? pollMs : 5000);
    }

    updatePollingConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        if (newConfig.interval != null) this.config.interval = newConfig.interval;
        else this.config.interval = this.getIntervalMs();
        logger.info(`Polling config: enabled=${this.config.enabled}, interval=${this.config.interval}ms, scheme=${this.config.scheme}`);

        if (this.config.enabled && this.running && !this.timer) {
            this.poll();
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.config.interval = this.getIntervalMs();
        this.poll();
        logger.info(`JobWorker started (polling ${this.config.enabled ? 'ON' : 'OFF'}, interval=${this.config.interval}ms)`);
    }

    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('JobWorker stopped');
    }

    async poll() {
        if (!this.running) return;

        if (!this.config.enabled) {
            this.timer = null;
            logger.debug('Polling skipped: disabled in settings');
            return;
        }

        if (!store.get('registered')) {
            logger.debug('Polling skipped: device not registered');
            this.scheduleNext(10000);
            return;
        }

        if (!waService.getStatus().ready) {
            // Jangan jadwalkan poll lagi; akan dipicu lagi saat WA ready (main.js)
            return;
        }

        try {
            const job = await apiClient.getNextJob();
            if (job) {
                this.emit('job_pending', { job });
                await this.processJob(job);
                if (this.config.scheme === 'smart') {
                    this.scheduleNext(500);
                } else {
                    this.scheduleNext(this.config.interval);
                }
            } else {
                this.scheduleNext(this.config.interval);
            }
        } catch (error) {
            logger.error('Error in poll loop:', error);
            this.scheduleNext(Math.max(this.config.interval, 10000));
        }
    }

    scheduleNext(ms) {
        if (!this.running || !this.config.enabled) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.poll(), ms);
    }

    async processJob(job) {
        logger.info(`Processing job ${job.id} for ${job.to}`);
        this.emit('job_start', job);
        try {
            await apiClient.updateJobStatus(job.id, 'sending');

            const result = await waService.sendMessage(job.to, job.message);

            await apiClient.updateJobStatus(job.id, 'sent', result);
            logger.info(`Job ${job.id} sent successfully`);
            this.emit('job_success', { job, result });
        } catch (error) {
            logger.error(`Job ${job.id} failed:`, error);
            await apiClient.updateJobStatus(job.id, 'failed', error);
            this.emit('job_failure', { job, error });
        }
    }
}

module.exports = new JobWorker();
