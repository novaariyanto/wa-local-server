const { ipcRenderer } = require('electron');

// --- State Management ---
const state = {
    view: 'dashboard',
    isConnected: true, // Internet
    stats: {
        sent: 0,
        failed: 0,
        monthSent: 0,
        lastError: null,
        cpu: 0,
        mem: 0,
        uptime: 0,
        waStatus: { ready: false, info: {} }
    },
    config: {},
    qr: null,
    qrTimer: null,
    monitor: {
        wa: false,
        manager: false,
        net: false
    }
};

// --- DOM References ---
const els = {
    // Nav
    navItems: document.querySelectorAll('.nav-item'),
    views: {
        dashboard: document.getElementById('view-dashboard'),
        activity: document.getElementById('view-activity'),
        system: document.getElementById('view-system'),
        settings: document.getElementById('view-settings'),
        test: document.getElementById('view-test'),
        qr: document.getElementById('view-qr')
    },
    // Header Card
    header: {
        devName: document.getElementById('db-device-name'),
        waName: document.getElementById('db-wa-name'),
        waNum: document.getElementById('db-wa-number'),
        waBadge: document.getElementById('badge-wa'),
        bars: {
            wa: document.getElementById('bar-wa'),
            mgr: document.getElementById('bar-mgr'),
            net: document.getElementById('bar-net')
        }
    },
    // Stats
    stats: {
        sent: document.getElementById('stat-sent-today'),
        failed: document.getElementById('stat-failed-today'),
        month: document.getElementById('stat-month-sent'),
        latency: document.getElementById('stat-latency'),
        cpu: document.getElementById('stat-cpu'),
        mem: document.getElementById('stat-mem')
    },
    errorPanel: document.getElementById('error-panel'),
    lastErrorMsg: document.getElementById('last-error-msg'),
    lastErrorTime: document.getElementById('last-error-time'),

    // Lists
    activityTable: document.getElementById('table-activity-body'),
    logsList: document.getElementById('logs-list'),

    // QR
    qrCanvas: document.getElementById('qr-canvas'),
    qrLoading: document.getElementById('qr-loading'),
    qrCountdown: document.getElementById('qr-countdown'),

    // Settings
    settings: {
        pollingEnabled: document.getElementById('setting-polling-enabled'),
        pollingInterval: document.getElementById('setting-polling-interval'),
        pollingScheme: document.getElementById('setting-polling-scheme'),
        btnSave: document.getElementById('btn-save-settings')
    },

    // Test Send
    testSend: {
        to: document.getElementById('test-send-to'),
        msg: document.getElementById('test-send-msg'),
        btn: document.getElementById('btn-test-send')
    },

    // Modals
    register: document.getElementById('view-register'),
    confirm: document.getElementById('modal-confirm'),
    toast: document.getElementById('toast-container'),

    // Actions
    btnGenerateQr: document.getElementById('btn-generate-qr'),
    btnRestart: document.getElementById('btn-restart'),
    btnLogout: document.getElementById('btn-logout')
};

// --- Initialization ---
(async () => {
    // Config
    const data = await ipcRenderer.invoke('get-initial-data');
    assignState(data);

    if (!state.config.registered) {
        els.register.classList.remove('hidden');
    }

    renderAll();
    populateSettings();

    // Start local uptime simulation for UI smoothness
    setInterval(() => {
        updateUptimeDisplay();
    }, 1000);

    // Periodic status refresh to ensure UI stays in sync with backend
    // especially important for production builds where events might be missed
    setInterval(() => {
        refreshStatus();
    }, 5000);
})();

async function refreshStatus() {
    try {
        const data = await ipcRenderer.invoke('get-status');
        const oldReady = state.stats.waStatus.ready;

        state.stats.waStatus = data.waStatus;
        state.stats.sent = data.stats.sent;
        state.stats.failed = data.stats.failed;
        state.stats.monthSent = data.stats.monthSent;
        state.stats.lastError = data.stats.lastError;
        state.serviceRunning = data.serviceRunning;

        renderAll();

        // If we transition from not ready to ready, trigger a view refresh
        if (!oldReady && state.stats.waStatus.ready) {
            state.qr = null;
            document.querySelector('.nav-item.active').click();
        }
    } catch (err) {
        console.error('Failed to sync status:', err);
    }
}

function assignState(data) {
    if (data.config) state.config = { ...state.config, ...data.config };
    if (data.stats) state.stats = { ...state.stats, ...data.stats };
    if (data.status) {
        state.stats.waStatus = data.status.waStatus;
        if (data.status.serviceRunning !== undefined) state.serviceRunning = data.status.serviceRunning;
    }
    if (data.serviceRunning !== undefined) state.serviceRunning = data.serviceRunning;
}

// --- Rendering ---
function renderAll() {
    renderHeader();
    renderStats();
    renderBars();
    renderPollingStatus();
}

function renderPollingStatus() {
    const el = document.getElementById('polling-status-text');
    if (!el) return;
    const enabled = state.config.polling?.enabled !== false;
    const running = state.serviceRunning === true;
    const interval = state.config.polling?.interval || 5000;
    if (enabled && running) {
        el.textContent = `Polling: ON (setiap ${interval / 1000}s)`;
        el.style.color = 'var(--success)';
    } else if (enabled && !running) {
        el.textContent = 'Polling: menunggu layanan...';
        el.style.color = 'var(--warning)';
    } else {
        el.textContent = 'Polling: OFF';
        el.style.color = 'var(--text-light)';
    }
}

function renderHeader() {
    // Device Info
    els.header.devName.textContent = state.config.device_name || 'Unregistered';

    if (state.stats.waStatus.ready) {
        const info = state.stats.waStatus.info;
        els.header.waName.textContent = info.name || 'WhatsApp';
        els.header.waNum.textContent = info.number || 'Connected';
        els.header.waBadge.textContent = '🟢 Connected';
        els.header.waBadge.style.background = '#ecfdf5';
        els.header.waBadge.style.color = '#065f46';
        if (els.btnGenerateQr) els.btnGenerateQr.classList.add('hidden');
    } else {
        els.header.waName.textContent = '--';
        els.header.waNum.textContent = 'Disconnected';

        if (state.qr) {
            els.header.waBadge.textContent = '🔵 QR Scan Required';
            els.header.waBadge.style.background = '#eff6ff';
            els.header.waBadge.style.color = '#1e40af';
        } else {
            els.header.waBadge.textContent = '🔴 Offline';
            els.header.waBadge.style.background = '#fef2f2';
            els.header.waBadge.style.color = '#991b1b';
        }
        if (els.btnGenerateQr) els.btnGenerateQr.classList.remove('hidden');
    }
}

function renderBars() {
    // WA
    updateBar(els.header.bars.wa, state.stats.waStatus.ready);
    // Net
    updateBar(els.header.bars.net, state.isConnected);
    // Mgr (Assumed connected if net is up + registered)
    updateBar(els.header.bars.mgr, state.isConnected && state.config.registered);
}

function updateBar(el, active) {
    el.style.width = active ? '100%' : '100%';
    el.className = active ? 'conn-fill green' : 'conn-fill red';
}

function renderStats() {
    els.stats.sent.textContent = state.stats.sent;
    els.stats.failed.textContent = state.stats.failed;
    els.stats.month.textContent = state.stats.monthSent;
    els.stats.cpu.textContent = state.stats.cpu + '%';
    els.stats.mem.textContent = state.stats.mem + '%';

    if (state.stats.lastError) {
        els.errorPanel.classList.remove('hidden');
        els.lastErrorMsg.textContent = state.stats.lastError.message;
        els.lastErrorTime.textContent = new Date(state.stats.lastError.time).toLocaleTimeString();
    } else {
        els.errorPanel.classList.add('hidden');
    }
}

function updateUptimeDisplay() {
    const el = document.getElementById('uptime-display');
    const now = process.uptime();
    const h = Math.floor(now / 3600).toString().padStart(2, '0');
    const m = Math.floor((now % 3600) / 60).toString().padStart(2, '0');
    el.textContent = `${h}:${m}`;
}

// --- Navigation ---
const viewTitles = {
    dashboard: { title: 'My Dashboard', subtitle: 'Live Monitoring' },
    activity: { title: 'Message Logs', subtitle: 'Detailed Activity' },
    system: { title: 'System Events', subtitle: 'Debug & Errors' },
    settings: { title: 'Configuration', subtitle: 'Polling & Options' },
    test: { title: 'Test Message', subtitle: 'Manual Send' }
};

els.navItems.forEach(item => {
    item.addEventListener('click', () => {
        state.view = item.dataset.view;

        els.navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const view = state.view;
        Object.values(els.views).forEach(el => { if (el) el.classList.add('hidden'); });

        const titleEl = document.getElementById('view-title');
        const subtitleEl = document.getElementById('view-subtitle');

        // QR Override
        if (state.qr && !state.stats.waStatus.ready) {
            if (els.views.qr) els.views.qr.classList.remove('hidden');
            if (titleEl) titleEl.textContent = 'Link Device';
            if (subtitleEl) subtitleEl.textContent = 'Scan QR Code';
        } else {
            const viewEl = els.views[view];
            if (viewEl) viewEl.classList.remove('hidden');
            const meta = viewTitles[view];
            if (meta && titleEl) titleEl.textContent = meta.title;
            if (meta && subtitleEl) subtitleEl.textContent = meta.subtitle;
        }
    });
});

// --- Table & Logs ---
function addActivityRow(job, status, info = '') {
    const time = new Date().toLocaleTimeString();
    let badgeClass = 'text-gray-500';
    let statusText = status;
    if (status === 'sent') { badgeClass = 'text-green-600 font-bold'; statusText = 'Success'; }
    if (status === 'failed') { badgeClass = 'text-red-600 font-bold'; statusText = 'Failed'; }
    if (status === 'sending') { badgeClass = 'text-blue-600'; statusText = 'Sending...'; }
    if (status === 'pending') { badgeClass = 'text-amber-600 font-medium'; statusText = 'Pending'; }

    const tr = document.createElement('tr');
    tr.dataset.jobId = String(job.id);
    tr.innerHTML = `
        <td>${time}</td>
        <td>#${job.id}</td>
        <td>${job.to}</td>
        <td class="${badgeClass}">${statusText}</td>
        <td><span style="font-size:11px;color:#6b7280">${(info || '').substring(0, 30)}</span></td>
    `;
    els.activityTable.prepend(tr);
    while (els.activityTable.children.length > 50) els.activityTable.lastChild.remove();
}

function updateActivityRowStatus(jobId, status, info = '') {
    const tr = els.activityTable.querySelector(`tr[data-job-id="${jobId}"]`);
    if (!tr) return false;
    const tdStatus = tr.querySelector('td:nth-child(4)');
    const tdInfo = tr.querySelector('td:nth-child(5) span');
    if (!tdStatus) return false;
    let badgeClass = 'text-gray-500';
    let statusText = status;
    if (status === 'sent') { badgeClass = 'text-green-600 font-bold'; statusText = 'Success'; }
    if (status === 'failed') { badgeClass = 'text-red-600 font-bold'; statusText = 'Failed'; }
    if (status === 'sending') { badgeClass = 'text-blue-600'; statusText = 'Sending...'; }
    if (status === 'pending') { badgeClass = 'text-amber-600 font-medium'; statusText = 'Pending'; }
    tdStatus.className = badgeClass;
    tdStatus.textContent = statusText;
    if (tdInfo) tdInfo.textContent = (info || '').substring(0, 30);
    return true;
}

function addLog(msg) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="log-ts">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    els.logsList.prepend(div);
    if (els.logsList.children.length > 100) els.logsList.lastChild.remove();
}

// --- Notifications ---
function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'information-circle';
    if (type === 'success') icon = 'checkmark-circle';
    if (type === 'error') icon = 'alert-circle';

    toast.innerHTML = `<ion-icon name="${icon}"></ion-icon> ${msg}`;
    els.toast.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- IPC Listeners ---
ipcRenderer.on('monitor-update', (event, stats) => {
    state.stats.cpu = stats.cpu;
    state.stats.mem = stats.mem;
    renderStats();
});

ipcRenderer.on('activity-update', (event, { type, job, result, error }) => {
    if (type === 'job_pending') {
        addActivityRow(job, 'pending');
    } else if (type === 'job_start') {
        if (!updateActivityRowStatus(job.id, 'sending')) addActivityRow(job, 'sending');
    } else if (type === 'job_success') {
        if (!updateActivityRowStatus(job.id, 'sent')) addActivityRow(job, 'sent');
        showToast(`Message to ${job.to} sent`, 'success');
    } else if (type === 'job_failure') {
        if (!updateActivityRowStatus(job.id, 'failed', error)) addActivityRow(job, 'failed', error);
        showToast(`Failed to send to ${job.to}`, 'error');
    }
});

ipcRenderer.on('stats-update', (event, newStats) => {
    state.stats.sent = newStats.sent;
    state.stats.failed = newStats.failed;
    state.stats.monthSent = newStats.monthSent;
    state.stats.lastError = newStats.lastError;
    renderStats();
});

ipcRenderer.on('internet-status', (event, connected) => {
    state.isConnected = connected;
    renderBars();
    if (!connected) showToast('Internet Connection Lost', 'error');
});

ipcRenderer.on('wa-qr', (event, qr) => {
    state.qr = qr;
    state.stats.waStatus.ready = false;
    renderAll();

    // Logic for QR view
    const QRCode = require('qrcode');
    els.qrLoading.classList.remove('hidden');

    QRCode.toCanvas(els.qrCanvas, qr, { width: 250, margin: 1 }, () => {
        els.qrLoading.classList.add('hidden');
    });

    // Handle Countdown
    if (state.qrTimer) clearInterval(state.qrTimer);
    let timeLeft = 20;
    els.qrCountdown.textContent = `Refreshing in ${timeLeft}s`;
    state.qrTimer = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft <= 0) {
            clearInterval(state.qrTimer);
            els.qrCountdown.textContent = 'Requesting new QR...';
        } else {
            els.qrCountdown.textContent = `Refreshing in ${timeLeft}s`;
        }
    }, 1000);

    // Force switch to active view check (will show QR overlay)
    document.querySelector('.nav-item.active').click();
});

ipcRenderer.on('wa-ready', (event, info) => {
    state.qr = null;
    if (state.qrTimer) {
        clearInterval(state.qrTimer);
        state.qrTimer = null;
    }
    state.stats.waStatus = { ready: true, info };
    renderAll();
    showToast('WhatsApp Connected Successfully', 'success');
    // Force switch to hide QR
    document.querySelector('.nav-item.active').click();
});

ipcRenderer.on('wa-authenticated', (event) => {
    state.qr = null;
    if (state.qrTimer) {
        clearInterval(state.qrTimer);
        state.qrTimer = null;
    }
    els.header.waBadge.textContent = '🟡 Authenticated';
    els.header.waBadge.style.background = '#fef9c3';
    els.header.waBadge.style.color = '#854d0e';
    showToast('WhatsApp Authenticated. Restoring session...', 'info');
    document.querySelector('.nav-item.active').click();
});

ipcRenderer.on('wa-loading', (event, { percent, message }) => {
    els.header.waBadge.textContent = `🟡 Loading ${percent}%`;
    els.header.waBadge.style.background = '#fef9c3';
    els.header.waBadge.style.color = '#854d0e';
});

ipcRenderer.on('wa-disconnected', (event, reason) => {
    state.stats.waStatus.ready = false;
    renderAll();
    showToast(`WhatsApp Disconnected: ${reason}`, 'error');
    addLog(`WA Disconnected: ${reason}`);
});

// --- Actions ---
// Register matches previous logic...
document.getElementById('btn-register').addEventListener('click', async () => {
    // ... existing register logic ...
    const url = document.getElementById('reg-manager-url').value;
    const code = document.getElementById('reg-auth-code').value;
    const name = document.getElementById('reg-device-name').value;

    if (!url || !code) return;

    const res = await ipcRenderer.invoke('register-device', { managerUrl: url, authCode: code, deviceName: name });
    if (res.success) window.location.reload();
    else document.getElementById('reg-error').textContent = res.error;
});

els.btnGenerateQr.addEventListener('click', async () => {
    if (els.btnGenerateQr.disabled) return;
    els.btnGenerateQr.disabled = true;
    els.btnGenerateQr.innerHTML = '<ion-icon name="sync-outline"></ion-icon> Generating...';

    // Switch to QR View
    Object.values(els.views).forEach(el => el.classList.add('hidden'));
    els.views.qr.classList.remove('hidden');
    els.qrLoading.classList.remove('hidden');

    const res = await ipcRenderer.invoke('generate-qr');
    if (!res.success) {
        showToast('Failed to generate QR: ' + res.error, 'error');
        els.btnGenerateQr.disabled = false;
        els.btnGenerateQr.innerHTML = '<ion-icon name="qr-code-outline"></ion-icon> Generate QR';
    } else {
        showToast('Requesting new QR Code...', 'info');
        els.btnGenerateQr.disabled = false;
        els.btnGenerateQr.innerHTML = '<ion-icon name="qr-code-outline"></ion-icon> Generate QR';
    }
});

// --- Settings ---
function populateSettings() {
    if (!state.config.polling) return;
    els.settings.pollingEnabled.checked = state.config.polling.enabled;
    els.settings.pollingInterval.value = state.config.polling.interval;
    els.settings.pollingScheme.value = state.config.polling.scheme;
}

els.settings.btnSave.addEventListener('click', async () => {
    const data = {
        enabled: els.settings.pollingEnabled.checked,
        interval: parseInt(els.settings.pollingInterval.value, 10),
        scheme: els.settings.pollingScheme.value
    };

    if (isNaN(data.interval) || data.interval < 1000) {
        showToast('Interval must be at least 1000ms', 'error');
        return;
    }

    els.settings.btnSave.disabled = true;
    els.settings.btnSave.innerHTML = '<ion-icon name="sync-outline"></ion-icon> Saving...';

    const res = await ipcRenderer.invoke('save-polling-config', data);

    els.settings.btnSave.disabled = false;
    els.settings.btnSave.innerHTML = '<ion-icon name="save-outline"></ion-icon> Save Configuration';

    if (res.success) {
        state.config.polling = data;
        showToast('Polling configuration saved automatically', 'success');
    } else {
        showToast('Failed to save config: ' + res.error, 'error');
    }
});

// --- Test Send ---
els.testSend.btn.addEventListener('click', async () => {
    const to = els.testSend.to.value.trim();
    const msg = els.testSend.msg.value.trim();

    if (!to || !msg) {
        showToast('Please fill both number and message', 'error');
        return;
    }

    if (!state.stats.waStatus.ready) {
        showToast('WhatsApp is not ready', 'error');
        return;
    }

    els.testSend.btn.disabled = true;
    els.testSend.btn.innerHTML = '<ion-icon name="sync-outline"></ion-icon> Sending...';

    const res = await ipcRenderer.invoke('test-send-message', { to, message: msg });

    els.testSend.btn.disabled = false;
    els.testSend.btn.innerHTML = '<ion-icon name="send-outline"></ion-icon> Send Message';

    if (res.success) {
        showToast('Message sent successfully', 'success');
        els.testSend.msg.value = '';
    } else {
        showToast('Failed to send: ' + res.error, 'error');
    }
});

els.btnRestart.addEventListener('click', () => {
    showConfirm('Restart Service?', async () => {
        await ipcRenderer.invoke('start-service');
        showToast('Service Restart Initiated');
    });
});

els.btnLogout.addEventListener('click', () => {
    showConfirm('Logout & Reset Data?', async () => {
        await ipcRenderer.invoke('logout-reset');
        window.location.reload();
    });
});

// Confirm Modal
let modalCb;
function showConfirm(msg, cb) {
    document.getElementById('confirm-message').textContent = msg;
    els.confirm.classList.remove('hidden');
    modalCb = cb;
}
document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    els.confirm.classList.add('hidden');
    if (modalCb) modalCb();
});
document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
    els.confirm.classList.add('hidden');
});
