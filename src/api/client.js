const axios = require('axios');
const store = require('../config/store');
const logger = require('../logger');

const getClient = () => {
    const baseURL = store.get('manager_url');
    const token = store.get('device_token');

    if (!baseURL) return null;

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Force IPv4 to avoid ECONNREFUSED ::1 error
    const http = require('http');
    const https = require('https');

    return axios.create({
        baseURL,
        headers,
        timeout: 10000,
        httpAgent: new http.Agent({ family: 4 }),
        httpsAgent: new https.Agent({ family: 4 })
    });
};

const register = async (managerUrl, authCode, deviceName) => {
    try {
        // Force IPv4 to avoid ECONNREFUSED ::1 error
        const http = require('http');
        const https = require('https');

        const client = axios.create({
            baseURL: managerUrl,
            headers: { 'Content-Type': 'application/json' },
            httpAgent: new http.Agent({ family: 4 }),
            httpsAgent: new https.Agent({ family: 4 })
        });

        logger.info(`Registering with manager: ${managerUrl}`);
        logger.info(`Auth code: ${authCode}, Device name: ${deviceName}`);

        const response = await client.post('/api/device/register', {
            auth_code: authCode,
            device_name: deviceName
        });

        logger.info('Response received:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.success && response.data.device_token) {
            logger.info('✅ Registration successful!');
            logger.info(`Device Token: ${response.data.device_token}`);
            logger.info(`Instance ID: ${response.data.instance_id}`);
            logger.info(`Instance Key: ${response.data.instance_key}`);

            store.set('manager_url', managerUrl);
            store.set('device_token', response.data.device_token);
            store.set('instance_id', String(response.data.instance_id));
            store.set('instance_key', response.data.instance_key);
            store.set('device_name', deviceName);
            store.set('registered', true);

            // Store poll interval if provided
            if (response.data.poll_ms) {
                store.set('poll_ms', response.data.poll_ms);
                logger.info(`Poll interval: ${response.data.poll_ms}ms`);
            }

            logger.info('Configuration saved. Ready to start services!');
            return response.data;
        } else {
            logger.error('Invalid response structure:', response.data);
            throw new Error('Invalid response from server: missing required fields');
        }
    } catch (error) {
        logger.error('Registration failed:', error.response?.data || error.message);
        throw error;
    }
};

const heartbeat = async (waState, waNumber, waName) => {
    const client = getClient();
    if (!client) return;

    try {
        await client.post('/api/device/heartbeat', {
            wa_state: waState,
            wa_number: waNumber,
            wa_name: waName
        });
    } catch (error) {
        logger.error('Heartbeat failed:', error.message);
    }
};

const getNextJob = async () => {
    const client = getClient();
    if (!client) return null;

    try {
        const instanceId = store.get('instance_id');
        const response = await client.get(`/api/jobs/next`, {
            params: { instance_id: instanceId }
        });

        if (response.status === 200 && response.data) {
            logger.debug(`Got job: ${response.data.id} for ${response.data.to}`);
            return response.data;
        }
        return null;
    } catch (error) {
        if (error.response && error.response.status === 204) return null; // No jobs (204 No Content)
        if (error.response && error.response.status === 404) return null; // No jobs
        if (error.response && error.response.status === 401) {
            logger.error('Unauthorized! Token may be invalid. Please re-register.');
        } else {
            logger.error('Get next job failed:', error.message);
        }
        return null;
    }
};

const updateJobStatus = async (jobId, status, result = null) => {
    const client = getClient();
    if (!client) return;

    try {
        const payload = { status };
        if (result) {
            if (status === 'sent') {
                payload.external_id = result.id?._serialized || result.id;
            } else if (status === 'failed') {
                payload.error = result.message || result;
            }
        }

        await client.post(`/api/jobs/${jobId}/status`, payload);
    } catch (error) {
        logger.error(`Update job ${jobId} status failed:`, error.message);
        // Maybe retry queue here?
    }
};

module.exports = {
    register,
    heartbeat,
    getNextJob,
    updateJobStatus
};
