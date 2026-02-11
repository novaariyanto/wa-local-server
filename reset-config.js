/**
 * Reset Configuration Utility
 * 
 * Use this script to clear the stored configuration and force re-registration.
 * This is useful when you need to:
 * - Register with a new activation code
 * - Switch to a different wa-manager instance
 * - Fix 401 Unauthorized errors due to invalid tokens
 * 
 * Usage:
 * 1. Close the wa-server-local app completely
 * 2. Run: node reset-config.js
 * 3. Restart the app and register again with a new activation code
 */

const Store = require('electron-store');

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
    device_name: {
        type: 'string',
        default: 'WA-Server-Local'
    },
    registered: {
        type: 'boolean',
        default: false
    }
};

const store = new Store({ schema });

console.log('Current configuration:');
console.log('- Manager URL:', store.get('manager_url'));
console.log('- Device Name:', store.get('device_name'));
console.log('- Instance ID:', store.get('instance_id'));
console.log('- Instance Key:', store.get('instance_key'));
console.log('- Registered:', store.get('registered'));
console.log('');

console.log('Clearing configuration...');
store.clear();
console.log('✓ Configuration cleared!');
console.log('');
console.log('You can now restart the app and register with a new activation code.');
