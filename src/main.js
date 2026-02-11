const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const store = require('./config/store');
const logger = require('./logger');
const client = require('./api/client');
const waService = require('./wa/whatsapp');
const jobWorker = require('./worker/jobWorker');
const { clearWhatsAppSession } = require('./utils/sessionCleaner');
const statsManager = require('./utils/statsManager');
const checkInternetConnected = require('check-internet-connected');
const os = require('os-utils');

let mainWindow;
let tray;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // For simplicity in this local app
        },
        icon: path.join(__dirname, '../assets/icon.ico')
    });

    mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    // Ensure you have an icon in assets/icon.png or .ico
    // validating icon path might be needed, for now assuming it exists or using partial
    try {
        const iconPath = path.join(__dirname, '../assets/icon.ico');
        tray = new Tray(iconPath);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Show App', click: () => mainWindow.show() },
            {
                label: 'Quit', click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);
        tray.setToolTip('WA Server Local');
        tray.setContextMenu(contextMenu);

        tray.on('double-click', () => {
            mainWindow.show();
        });
    } catch (e) {
        logger.warn('Tray icon could not be created (maybe missing icon file)', e);
    }
}

app.whenReady().then(() => {
    createWindow();
    createTray();

    // Auto-start if registered
    if (store.get('registered')) {
        startServices();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC Handlers
ipcMain.handle('get-config', () => {
    return {
        manager_url: store.get('manager_url'),
        device_name: store.get('device_name'),
        registered: store.get('registered'),
        instance_id: store.get('instance_id'),
        instance_key: store.get('instance_key')
    };
});

ipcMain.handle('register-device', async (event, { managerUrl, authCode, deviceName }) => {
    try {
        const result = await client.register(managerUrl, authCode, deviceName);
        startServices(); // Start WA after successful registration
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('start-service', () => {
    startServices();
    return { success: true };
});

ipcMain.handle('stop-service', () => {
    stopServices();
    return { success: true };
});

ipcMain.handle('get-status', () => {
    return {
        serviceRunning: jobWorker.running,
        waStatus: waService.getStatus(),
        stats: statsManager.getStats()
    };
});

ipcMain.handle('get-initial-data', () => {
    return {
        config: {
            manager_url: store.get('manager_url'),
            device_name: store.get('device_name'),
            registered: store.get('registered'),
            instance_id: store.get('instance_id')
        },
        stats: statsManager.getStats(),
        status: {
            serviceRunning: jobWorker.running,
            waStatus: waService.getStatus()
        }
    };
});

ipcMain.handle('logout-reset', async () => {
    try {
        logger.info('Logout and reset requested');

        // Stop all services
        await waService.stop();
        jobWorker.stop();

        // Clear WhatsApp session
        const userDataPath = app.getPath('userData');
        await clearWhatsAppSession(userDataPath);

        // Clear store
        store.clear();

        logger.info('Configuration and session cleared successfully');
        return { success: true };
    } catch (error) {
        logger.error('Logout failed:', error);
        return { success: false, error: error.message };
    }
});

function startServices() {
    waService.start();
    jobWorker.start();
    startInternetCheck();
    startSystemMonitor();
}

function stopServices() {
    waService.stop();
    jobWorker.stop();
    stopInternetCheck();
    stopSystemMonitor();
}

let monitorInterval;

function startSystemMonitor() {
    if (monitorInterval) return;

    monitorInterval = setInterval(() => {
        os.cpuUsage((v) => {
            const stats = {
                cpu: (v * 100).toFixed(1),
                mem: (100 - os.freememPercentage() * 100).toFixed(1),
                uptime: os.processUptime()
            };

            if (mainWindow) {
                mainWindow.webContents.send('monitor-update', stats);
            }
        });
    }, 2000);
}

function stopSystemMonitor() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
}

// Job Worker Events
jobWorker.on('job_start', (job) => {
    if (mainWindow) mainWindow.webContents.send('activity-update', { type: 'job_start', job });
});

jobWorker.on('job_success', ({ job, result }) => {
    const stats = statsManager.incrementSent();
    if (mainWindow) {
        mainWindow.webContents.send('activity-update', { type: 'job_success', job, result });
        mainWindow.webContents.send('stats-update', stats);
    }
});

jobWorker.on('job_failure', ({ job, error }) => {
    const stats = statsManager.incrementFailed();
    if (mainWindow) {
        mainWindow.webContents.send('activity-update', { type: 'job_failure', job, error: error.message || error });
        mainWindow.webContents.send('stats-update', stats);
    }
});

// Internet Check
let internetCheckInterval;
function startInternetCheck() {
    if (internetCheckInterval) return;

    // Initial check
    checkInternet();

    internetCheckInterval = setInterval(checkInternet, 10000);
}

function stopInternetCheck() {
    if (internetCheckInterval) {
        clearInterval(internetCheckInterval);
        internetCheckInterval = null;
    }
}

function checkInternet() {
    checkInternetConnected()
        .then(() => {
            if (mainWindow) mainWindow.webContents.send('internet-status', true);
        })
        .catch(() => {
            if (mainWindow) mainWindow.webContents.send('internet-status', false);
        });
}

// Forward WA events to UI
waService.on('qr', (qr) => {
    if (mainWindow) mainWindow.webContents.send('wa-qr', qr);
});

waService.on('ready', (info) => {
    if (mainWindow) mainWindow.webContents.send('wa-ready', info);
    client.heartbeat('ready', info.number, info.name);
});

waService.on('auth_failure', (msg) => {
    if (mainWindow) mainWindow.webContents.send('wa-auth-failure', msg);
    client.heartbeat('auth_failure', '', '');
});

waService.on('disconnected', (reason) => {
    if (mainWindow) mainWindow.webContents.send('wa-disconnected', reason);
    client.heartbeat('disconnected', '', '');
});

// App lifecycle
app.on('before-quit', async () => {
    await waService.stop();
});
