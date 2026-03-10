const Store = require('electron-store');
const path = require('path');

// Configure store to save in AppData/WaServerLocal
// Default path is usually %APPDATA%/Name/config.json
// We can use the default behavior of electron-store which stores in app.getPath('userData')

const schema = {
    manager_url: {
        type: 'string',
        default: ''
    },
    device_token: {
        type: 'string',
        default: ''
    },
    device_id: {
        type: ['string', 'number'],
        default: ''
    },
    instance_id: {
        type: ['string', 'number'],
        default: ''
    },
    instance_key: {
        type: 'string',
        default: ''
    },
    poll_ms: {
        type: 'number',
        default: 2000
    },
    device_name: {
        type: 'string',
        default: 'WA-Server-Local'
    },
    registered: {
        type: 'boolean',
        default: false
    },
    api_port: {
        type: 'number',
        default: 3742
    }
};

const store = new Store({ schema });

module.exports = store;
