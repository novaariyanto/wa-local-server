const fs = require('fs');
const path = require('path');
const logger = require('../logger');

/**
 * Clear WhatsApp session data
 * This removes the .wwebjs_auth folder to force re-authentication
 */
async function clearWhatsAppSession(userDataPath) {
    try {
        const sessionPath = path.join(userDataPath, '.wwebjs_auth');

        if (fs.existsSync(sessionPath)) {
            logger.info(`Clearing WhatsApp session at: ${sessionPath}`);

            // Recursively delete directory
            fs.rmSync(sessionPath, { recursive: true, force: true });

            logger.info('WhatsApp session cleared successfully');
            return true;
        } else {
            logger.info('No WhatsApp session found to clear');
            return true;
        }
    } catch (error) {
        logger.error('Failed to clear WhatsApp session:', error);
        throw error;
    }
}

module.exports = { clearWhatsAppSession };
