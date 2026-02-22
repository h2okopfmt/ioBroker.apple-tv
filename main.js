'use strict';

const utils = require('@iobroker/adapter-core');
const { execFile } = require('child_process');
const { BackendFactory } = require('./lib/backend/backend-factory');
const { PyatvBackend } = require('./lib/backend/pyatv');
const { DeviceManager } = require('./lib/device-manager');
const { StreamingManager } = require('./lib/streaming/streaming-manager');

class AppleTvAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'apple-tv' });

        /** @type {Map<string, DeviceManager>} */
        this.devices = new Map();
        this.backendFactory = null;
        this.autoScanTimer = null;
        this.streamingManager = null;

        // Active pairing backends per device identifier (for multi-step pairing)
        /** @type {Map<string, import('./lib/backend/pyatv').PyatvBackend>} */
        this._pairingSessions = new Map();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ──────────────────────────────────────────────
    //  LIFECYCLE
    // ──────────────────────────────────────────────

    async onReady() {
        const backendType = this.config.backend || 'pyatv';

        // Step 1: Auto-install pyatv if needed
        if (backendType === 'pyatv') {
            let available = await PyatvBackend.checkInstalled();
            if (!available) {
                this.log.warn('pyatv not found - attempting automatic installation...');
                const installed = await PyatvBackend.installPyatv(this.log);
                if (installed) {
                    available = await PyatvBackend.checkInstalled();
                }
                if (!available) {
                    this.log.error('pyatv could not be installed automatically. Please install manually: pip3 install pyatv');
                    this.setState('info.connection', false, true);
                    return;
                }
            }
            this.log.info('pyatv backend available');
        }

        // Step 2: Create backend factory
        this.backendFactory = new BackendFactory(backendType, this.log);

        // Step 3: Auto-discovery - scan the network for Apple TVs
        const autoDiscovery = this.config.autoDiscovery !== false; // default: on
        if (autoDiscovery) {
            await this._autoDiscover();
        } else {
            // Manual mode: only use configured devices
            const configuredDevices = this.config.devices || [];
            for (const deviceConfig of configuredDevices) {
                try {
                    await this._initDevice(deviceConfig);
                } catch (err) {
                    this.log.error('Failed to initialize device ' + (deviceConfig.name || deviceConfig.identifier) + ': ' + err.message);
                }
            }
        }

        // Step 4: Initialize streaming manager and fetch channels
        this.streamingManager = new StreamingManager(this, this.log);
        this.streamingManager.init(this.config);

        let streamingChannels = new Map();
        if (this.streamingManager.providers.length > 0) {
            try {
                streamingChannels = await this.streamingManager.refreshAll();
                this.log.info('Streaming channels loaded from ' + streamingChannels.size + ' provider(s)');
            } catch (err) {
                this.log.warn('Failed to load streaming channels: ' + err.message);
            }
        }

        // Step 5: Refresh app lists with streaming channels for all devices
        for (const [_deviceId, manager] of this.devices) {
            try {
                await manager.refreshAppList(streamingChannels);
            } catch (err) {
                this.log.debug('Failed to refresh app list: ' + err.message);
            }
        }

        // Step 6: Set adapter connection state
        this.setState('info.connection', true, true);

        // Step 7: Subscribe to all states
        this.subscribeStates('*');

        // Step 8: Schedule periodic re-scan for new devices
        if (autoDiscovery) {
            const scanInterval = (this.config.scanInterval || 300) * 1000; // default: 5 min
            this.autoScanTimer = setInterval(() => {
                this._autoDiscover().catch(err => {
                    this.log.debug('Periodic scan failed: ' + err.message);
                });
            }, scanInterval);
        }

        // Step 9: Schedule periodic streaming channel refresh
        const streaming = this.config.streaming || {};
        const channelRefresh = (streaming.channelRefreshInterval || 3600) * 1000;
        if (this.streamingManager.providers.length > 0) {
            this.streamingManager.startPeriodicRefresh(streaming.channelRefreshInterval || 3600, async (channels) => {
                for (const [_devId, mgr] of this.devices) {
                    try {
                        await mgr.refreshAppList(channels);
                    } catch (err) {
                        this.log.debug('Periodic app refresh failed: ' + err.message);
                    }
                }
            });
        }
    }

    /**
     * Auto-discover Apple TVs on the network.
     * - Scans the network
     * - Creates state trees for new devices
     * - Merges scan results with existing config (preserves credentials)
     * - Saves updated config automatically
     */
    async _autoDiscover() {
        this.log.info('Scanning network for Apple TV devices...');
        try {
            const scanBackend = this.backendFactory.create({});
            const scanHosts = this.config.scanHosts || '';
            const foundDevices = await scanBackend.scan(scanHosts);
            this.log.info('Found ' + foundDevices.length + ' Apple TV(s) on network');

            if (foundDevices.length === 0) return;

            // Load existing devices config to preserve credentials
            const existingDevices = this.config.devices || [];
            let configChanged = false;

            for (const found of foundDevices) {
                if (!found.identifier) continue;

                // Check if device already exists in config
                let existing = existingDevices.find(d =>
                    d.identifier === found.identifier ||
                    (d.mac && d.mac === found.mac) ||
                    (d.address && d.address === found.address)
                );

                if (!existing) {
                    // New device found - add to config
                    existing = {
                        name: found.name,
                        address: found.address,
                        identifier: found.identifier,
                        mac: found.mac,
                        model: found.model,
                        modelStr: found.modelStr,
                        os: found.os,
                        osVersion: found.osVersion,
                        airplayCredentials: '',
                        companionCredentials: '',
                        mrpCredentials: '',
                    };
                    existingDevices.push(existing);
                    configChanged = true;
                    this.log.info('New Apple TV discovered: ' + found.name + ' (' + found.identifier + ')');
                } else {
                    // Update address/name (they can change via DHCP)
                    if (found.address && existing.address !== found.address) {
                        existing.address = found.address;
                        configChanged = true;
                    }
                    if (found.name && existing.name !== found.name) {
                        existing.name = found.name;
                        configChanged = true;
                    }
                    if (found.osVersion && existing.osVersion !== found.osVersion) {
                        existing.osVersion = found.osVersion;
                        configChanged = true;
                    }
                }

                // Initialize device if not already managed
                const deviceId = this._sanitizeId(existing.identifier || existing.mac || existing.address);
                if (!this.devices.has(deviceId)) {
                    try {
                        await this._initDevice(existing);
                    } catch (err) {
                        this.log.warn('Failed to init discovered device ' + existing.name + ': ' + err.message);
                    }
                }
            }

            // Save updated config back if new devices were found
            if (configChanged) {
                await this._saveDevicesConfig(existingDevices);
            }
        } catch (err) {
            this.log.warn('Auto-discovery scan failed: ' + err.message);
        }
    }

    /**
     * Initialize a single device: create backend, DeviceManager, state tree, connect.
     */
    async _initDevice(deviceConfig) {
        const rawId = deviceConfig.identifier || deviceConfig.mac || deviceConfig.address;
        if (!rawId) {
            this.log.warn('Device has no identifier, MAC or address - skipping');
            return;
        }

        const deviceId = this._sanitizeId(rawId);

        // Skip if already initialized
        if (this.devices.has(deviceId)) return;

        const backendConfig = {
            identifier: deviceConfig.identifier || '',
            address: deviceConfig.address || '',
            credentials: {
                mrp: deviceConfig.mrpCredentials || '',
                airplay: deviceConfig.airplayCredentials || '',
                companion: deviceConfig.companionCredentials || '',
            },
        };

        const backend = this.backendFactory.create(backendConfig);
        const manager = new DeviceManager(this, deviceId, deviceConfig, backend);
        this.devices.set(deviceId, manager);

        await manager.createStateTree();
        await manager.connect();

        this.log.info('Device initialized: ' + (deviceConfig.name || deviceId));
    }

    // ──────────────────────────────────────────────
    //  STATE CHANGES (remote control, power, etc.)
    // ──────────────────────────────────────────────

    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const adapterPrefix = this.namespace + '.';
        if (!id.startsWith(adapterPrefix)) return;

        const relativePath = id.substring(adapterPrefix.length);
        const parts = relativePath.split('.');
        if (parts.length < 3) return;

        const deviceId = parts[0];
        const channel = parts[1];
        const stateName = parts[2];

        const manager = this.devices.get(deviceId);
        if (!manager) {
            this.log.warn('State change for unknown device: ' + deviceId);
            return;
        }

        try {
            if (channel === 'remote') {
                await manager.handleRemoteCommand(stateName);
            } else if (channel === 'power' && stateName === 'state') {
                await manager.handlePowerCommand(state.val);
            } else if (channel === 'playing' && stateName === 'position') {
                await manager.handleSeek(state.val);
            } else if (channel === 'apps') {
                if (stateName === 'launch' && parts.length === 3) {
                    // apps.launch = bundleId string
                    await manager.handleAppLaunch(state.val);
                } else if (parts.length === 4 && parts[3] === 'launch') {
                    // apps.{appName}.launch
                    await manager.handleAppFolderLaunch(stateName);
                } else if (parts.length === 5 && parts[3] === 'channels') {
                    // apps.{appName}.channels.{channelName}
                    await manager.handleChannelButton(stateName, parts[4]);
                } else if (parts.length === 3 && stateName !== 'list' && stateName !== 'current' && stateName !== 'currentId') {
                    // Legacy: flat app button (backward compat)
                    await manager.handleAppButton(stateName);
                }
            }
        } catch (err) {
            this.log.error('Error handling ' + channel + '.' + stateName + ': ' + err.message);
        }
    }

    // ──────────────────────────────────────────────
    //  ADMIN UI MESSAGES
    //  Handles: scan, pair start/pin/abort, pyatv check/install
    // ──────────────────────────────────────────────

    async onMessage(obj) {
        if (!obj || !obj.command) return;

        switch (obj.command) {

            // ── Scan for Apple TVs ──
            case 'scanDevices': {
                try {
                    const backendType = this.config.backend || 'pyatv';
                    const factory = new BackendFactory(backendType, this.log);
                    const backend = factory.create({});
                    const scanHosts = this.config.scanHosts || '';
                    const devices = await backend.scan(scanHosts);
                    this.log.info('Scan found ' + devices.length + ' Apple TV device(s)');
                    this._respond(obj, { devices });
                } catch (err) {
                    this.log.error('Scan failed: ' + err.message);
                    this._respond(obj, { error: err.message });
                }
                break;
            }

            // ── Start pairing (Step 1: triggers PIN on TV) ──
            case 'startPairing': {
                try {
                    const msg = obj.message || {};
                    const identifier = msg.identifier || msg.address;
                    if (!identifier) {
                        this._respond(obj, { error: 'No device identifier provided' });
                        return;
                    }

                    // Create a dedicated backend for this pairing session
                    const pairBackend = new PyatvBackend({
                        identifier: msg.identifier || '',
                        address: msg.address || '',
                        credentials: {},
                    }, this.log);

                    const result = await pairBackend.pairStart(msg.protocol || 'airplay');

                    if (result.status === 'awaitingPin') {
                        // Store the backend so we can send it the PIN later
                        this._pairingSessions.set(identifier, pairBackend);
                        this._respond(obj, { status: 'awaitingPin', identifier });
                    } else if (result.status === 'paired') {
                        // Some devices pair without PIN
                        await this._storePairCredentials(identifier, msg.protocol || 'airplay', result.credentials);
                        this._respond(obj, { status: 'paired', credentials: result.credentials });
                    }
                } catch (err) {
                    this._respond(obj, { error: err.message });
                }
                break;
            }

            // ── Submit PIN (Step 2: sends PIN to running pair process) ──
            case 'submitPin': {
                try {
                    const msg = obj.message || {};
                    const identifier = msg.identifier || msg.address;
                    const pin = String(msg.pin || '');

                    if (!pin || pin.length !== 4) {
                        this._respond(obj, { error: 'PIN must be exactly 4 digits' });
                        return;
                    }

                    const pairBackend = this._pairingSessions.get(identifier);
                    if (!pairBackend) {
                        this._respond(obj, { error: 'No active pairing session for ' + identifier + '. Start pairing first.' });
                        return;
                    }

                    const result = await pairBackend.pairFinish(pin);
                    this._pairingSessions.delete(identifier);

                    // Auto-save credentials to device config
                    if (result.credentials) {
                        await this._storePairCredentials(identifier, msg.protocol || 'airplay', result.credentials);
                    }

                    this._respond(obj, { status: 'paired', credentials: result.credentials });
                } catch (err) {
                    this._respond(obj, { error: err.message });
                }
                break;
            }

            // ── Abort pairing ──
            case 'abortPairing': {
                const msg = obj.message || {};
                const identifier = msg.identifier || msg.address;
                const pairBackend = this._pairingSessions.get(identifier);
                if (pairBackend) {
                    pairBackend.pairAbort();
                    this._pairingSessions.delete(identifier);
                }
                this._respond(obj, { status: 'aborted' });
                break;
            }

            // ── Test Streaming Provider ──
            case 'testStreaming': {
                try {
                    const msg = obj.message || {};
                    const providerKey = msg.provider;
                    if (!providerKey) {
                        this._respond(obj, { error: 'Kein Provider angegeben' });
                        return;
                    }

                    // Read current config for credentials
                    const streaming = this.config.streaming || {};
                    const credMap = {
                        waipu: { username: streaming.waipuUsername || '', password: streaming.waipuPassword || '' },
                        zattoo: { username: streaming.zattooUsername || '', password: streaming.zattooPassword || '' },
                        magentaTv: { username: streaming.magentaTvUsername || '', password: streaming.magentaTvPassword || '' },
                        plutoTv: {},
                        joyn: {},
                        ard: {},
                        zdf: {},
                        arte: {},
                    };

                    const { StreamingManager: SM } = require('./lib/streaming/streaming-manager');
                    const testMgr = new SM(this, this.log);
                    const credentials = credMap[providerKey] || {};

                    const result = await testMgr.testProvider(providerKey, credentials);

                    if (result.success) {
                        this._respond(obj, {
                            result: (result.providerName || providerKey) + ': ' + result.channels + ' Kanäle geladen',
                        });
                    } else {
                        this._respond(obj, {
                            error: (result.providerName || providerKey) + ': ' + (result.error || 'Verbindung fehlgeschlagen'),
                        });
                    }
                } catch (err) {
                    this._respond(obj, { error: 'Test fehlgeschlagen: ' + err.message });
                }
                break;
            }

            // ── Check pyatv ──
            case 'checkPyatv': {
                const available = await PyatvBackend.checkInstalled();
                this._respond(obj, { available });
                break;
            }

            // ── Install pyatv ──
            case 'installPyatv': {
                const installed = await PyatvBackend.installPyatv(this.log);
                const available = installed ? await PyatvBackend.checkInstalled() : false;
                this._respond(obj, { installed, available });
                break;
            }

            default:
                this.log.debug('Unknown message command: ' + obj.command);
        }
    }

    // ──────────────────────────────────────────────
    //  UNLOAD
    // ──────────────────────────────────────────────

    async onUnload(callback) {
        try {
            // Clear auto-scan timer
            if (this.autoScanTimer) {
                clearInterval(this.autoScanTimer);
                this.autoScanTimer = null;
            }

            // Stop streaming manager
            if (this.streamingManager) {
                this.streamingManager.stop();
            }

            // Abort any active pairing sessions
            for (const [_id, backend] of this._pairingSessions) {
                backend.pairAbort();
            }
            this._pairingSessions.clear();

            // Disconnect all devices
            for (const [_deviceId, manager] of this.devices) {
                await manager.disconnect();
            }
            this.devices.clear();
            this.setState('info.connection', false, true);
        } catch (err) {
            this.log.error('Error during unload: ' + err.message);
        } finally {
            callback();
        }
    }

    // ──────────────────────────────────────────────
    //  HELPER: Save credentials back to adapter config
    // ──────────────────────────────────────────────

    /**
     * After successful pairing, store the credentials in the adapter config
     * and reinitialize the device with new credentials.
     */
    async _storePairCredentials(identifier, protocol, credentials) {
        const devices = this.config.devices || [];
        const device = devices.find(d =>
            d.identifier === identifier || d.address === identifier
        );

        if (!device) {
            this.log.warn('Cannot store credentials: device ' + identifier + ' not found in config');
            return;
        }

        // Map protocol to the correct credentials field
        switch (protocol) {
            case 'airplay':
                device.airplayCredentials = credentials;
                break;
            case 'companion':
                device.companionCredentials = credentials;
                break;
            case 'mrp':
                device.mrpCredentials = credentials;
                break;
            default:
                device.airplayCredentials = credentials;
        }

        // Save updated config
        await this._saveDevicesConfig(devices);
        this.log.info('Credentials for ' + protocol + ' saved for device ' + (device.name || identifier));

        // Reconnect device with new credentials
        const deviceId = this._sanitizeId(device.identifier || device.mac || device.address);
        const existingManager = this.devices.get(deviceId);
        if (existingManager) {
            await existingManager.disconnect();
            this.devices.delete(deviceId);
        }
        try {
            await this._initDevice(device);
        } catch (err) {
            this.log.warn('Failed to reinit device after pairing: ' + err.message);
        }
    }

    /**
     * Save the devices array to the adapter's native config.
     * Uses extendForeignObjectAsync to update only the native.devices field.
     */
    async _saveDevicesConfig(devices) {
        try {
            await this.extendForeignObjectAsync('system.adapter.' + this.namespace, {
                native: { devices },
            });
            // Update local config cache
            this.config.devices = devices;
            this.log.debug('Device config saved (' + devices.length + ' devices)');
        } catch (err) {
            this.log.error('Failed to save device config: ' + err.message);
        }
    }

    // ──────────────────────────────────────────────
    //  UTILITY
    // ──────────────────────────────────────────────

    _sanitizeId(raw) {
        return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    _respond(obj, data) {
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, data, obj.callback);
        }
    }
}

// Support compact mode
if (require.main !== module) {
    module.exports = (options) => new AppleTvAdapter(options);
} else {
    new AppleTvAdapter();
}
