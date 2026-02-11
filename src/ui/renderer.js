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

    // Modals
    register: document.getElementById('view-register'),
    confirm: document.getElementById('modal-confirm'),
    toast: document.getElementById('toast-container'),

    // Actions
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

    // Start local uptime simulation for UI smoothness
    setInterval(() => {
        updateUptimeDisplay();
    }, 1000);
})();

function assignState(data) {
    if (data.config) state.config = { ...state.config, ...data.config };
    if (data.stats) state.stats = { ...state.stats, ...data.stats };
    if (data.status) {
        state.stats.waStatus = data.status.waStatus;
    }
}

// --- Rendering ---
function renderAll() {
    renderHeader();
    renderStats();
    renderBars();
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
els.navItems.forEach(item => {
    item.addEventListener('click', () => {
        els.navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const view = item.dataset.view;
        Object.values(els.views).forEach(el => el.classList.add('hidden'));

        // QR Override
        if (state.qr && !state.stats.waStatus.ready) {
            els.views.qr.classList.remove('hidden');
        } else {
            els.views[view].classList.remove('hidden');
            if (view === 'dashboard') document.getElementById('view-title').textContent = 'My Dashboard';
            if (view === 'activity') document.getElementById('view-title').textContent = 'Message Logs';
            if (view === 'system') document.getElementById('view-title').textContent = 'System Events';
        }
    });
});

// --- Table & Logs ---
function addActivityRow(job, status, info = '') {
    const tr = document.createElement('tr');
    const time = new Date().toLocaleTimeString();

    let badgeClass = 'text-gray-500';
    let statusText = status;

    if (status === 'sent') { badgeClass = 'text-green-600 font-bold'; statusText = 'Success'; }
    if (status === 'failed') { badgeClass = 'text-red-600 font-bold'; statusText = 'Failed'; }
    if (status === 'sending') { badgeClass = 'text-blue-600'; statusText = 'Sending...'; }

    tr.innerHTML = `
        <td>${time}</td>
        <td>#${job.id}</td>
        <td>${job.to}</td>
        <td class="${badgeClass}">${statusText}</td>
        <td><span style="font-size:11px;color:#6b7280">${info.substring(0, 30)}</span></td>
    `;

    els.activityTable.prepend(tr);
    if (els.activityTable.children.length > 50) els.activityTable.lastChild.remove();
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
    if (type === 'job_start') {
        addActivityRow(job, 'sending');
    } else if (type === 'job_success') {
        addActivityRow(job, 'sent');
        showToast(`Message to ${job.to} sent`, 'success');
    } else if (type === 'job_failure') {
        addActivityRow(job, 'failed', error);
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

    // Force switch to active view check (will show QR overlay)
    document.querySelector('.nav-item.active').click();
});

ipcRenderer.on('wa-ready', (event, info) => {
    state.qr = null;
    state.stats.waStatus = { ready: true, info };
    renderAll();
    showToast('WhatsApp Connected Successfully', 'success');
    // Force switch to hide QR
    document.querySelector('.nav-item.active').click();
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
