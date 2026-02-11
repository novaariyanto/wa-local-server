const store = require('../config/store');

class StatsManager {
    constructor() {
        this.today = new Date().toDateString();
        // Check resets on startup
        this.checkDailyReset();
        this.checkMonthlyReset();
    }

    // --- Daily Logic ---
    checkDailyReset() {
        const lastReset = store.get('stats_date');
        const currentGenericDate = new Date().toDateString();

        if (lastReset !== currentGenericDate) {
            store.set('stats_date', currentGenericDate);
            store.set('stats_sent', 0);
            store.set('stats_failed', 0);
            this.today = currentGenericDate;
        }
    }

    // --- Monthly Logic ---
    checkMonthlyReset() {
        const lastMonth = store.get('stats_month_date');
        const currentMonth = new Date().getMonth(); // 0-11

        // If stored month is different from current month
        if (lastMonth !== currentMonth) {
            store.set('stats_month_date', currentMonth);
            store.set('stats_month_sent', 0);
        }
    }

    // --- Actions ---
    incrementSent() {
        this.checkDailyReset();
        this.checkMonthlyReset();

        // Daily
        const currentDaily = store.get('stats_sent') || 0;
        store.set('stats_sent', currentDaily + 1);

        // Monthly
        const currentMonthly = store.get('stats_month_sent') || 0;
        store.set('stats_month_sent', currentMonthly + 1);

        return this.getStats();
    }

    incrementFailed(errorMessage) {
        this.checkDailyReset();

        const current = store.get('stats_failed') || 0;
        store.set('stats_failed', current + 1);

        if (errorMessage) {
            store.set('last_error', {
                time: new Date().toISOString(),
                message: errorMessage
            });
        }

        return this.getStats();
    }

    // --- Retrieval ---
    getStats() {
        this.checkDailyReset();
        this.checkMonthlyReset();

        return {
            sent: store.get('stats_sent') || 0,
            failed: store.get('stats_failed') || 0,
            monthSent: store.get('stats_month_sent') || 0,
            lastError: store.get('last_error') || null,
            date: store.get('stats_date')
        };
    }
}

module.exports = new StatsManager();
