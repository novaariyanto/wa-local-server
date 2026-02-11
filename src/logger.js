const log = require('electron-log');
const path = require('path');

// Configure logger
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Optional: Set custom log file location or format if needed
// By default it logs to %USERPROFILE%\AppData\Roaming\<app name>\logs\main.log

// Export specific functions for convenience
module.exports = {
    info: log.info,
    warn: log.warn,
    error: log.error,
    debug: log.debug,
    verbose: log.verbose
};
