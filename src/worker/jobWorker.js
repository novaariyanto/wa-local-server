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
        this.interval = 5000; // 5 seconds default
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.poll();
        logger.info('JobWorker started');
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

        // Wait if WA is not ready or not registered
        if (!store.get('registered')) {
            this.scheduleNext(10000); // Wait longer if not registered
            return;
        }

        if (!waService.getStatus().ready) {
            // Maybe update heartbeat as not ready?
            // But valid jobs need WA Ready.
            this.scheduleNext(5000);
            return;
        }

        try {
            const job = await apiClient.getNextJob();
            if (job) {
                await this.processJob(job);
                // If we got a job, poll again sooner
                this.scheduleNext(500);
            } else {
                this.scheduleNext(this.interval);
            }
        } catch (error) {
            logger.error('Error in poll loop:', error);
            this.scheduleNext(10000); // Backoff on error
        }
    }

    scheduleNext(ms) {
        if (!this.running) return;
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
