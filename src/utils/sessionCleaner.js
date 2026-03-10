const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../logger');

/**
 * Clear WhatsApp session data or Chrome Profile data
 * This removes the passed directory forcefully
 */
async function clearWhatsAppSession(targetPath) {
    try {
        if (fs.existsSync(targetPath)) {
            logger.info(`Clearing directory at: ${targetPath}`);

            // Use built-in Node fs.promises.rm which has robust retry mechanism for Windows
            await fsPromises.rm(targetPath, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 1000
            });

            logger.info('Directory cleared successfully');
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
