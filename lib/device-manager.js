'use strict';

const { STATE_DEFINITIONS } = require('./state-definitions');
const {
    RECONNECT_BASE_DELAY,
    RECONNECT_MAX_DELAY,
    MAX_RECONNECT_ATTEMPTS,
} = require('./constants');

class DeviceManager {
    /**
     * @param {import('@iobroker/adapter-core').Adapter} adapter
     * @param {string} deviceId - Sanitized device identifier for ioBroker object tree
     * @param {object} deviceConfig - From adapter config (name, address, identifier, credentials, ...)
     * @param {import('./backend/base').BaseBackend} backend
     */
    constructor(adapter, deviceId, deviceConfig, backend) {
        this.adapter = adapter;
        this.deviceId = deviceId;
        this.deviceConfig = deviceConfig;
        this.backend = backend;

        this.pushHandle = null;
        this.pollTimer = null;
        this.reconnectTimer = null;
        this.artworkTimer = null;
        this.connected = false;
        this.reconnectAttempts = 0;
    }

    /**
     * Create the full ioBroker object tree for this device.
     */
    async createStateTree() {
        const prefix = this.deviceId;

        // Create device object
        await this.adapter.setObjectNotExistsAsync(prefix, {
            type: 'device',
            common: { name: this.deviceConfig.name || this.deviceId },
            native: {},
        });

        // Create channels and states from definitions
        for (const [channelName, states] of Object.entries(STATE_DEFINITIONS)) {
            const channelId = prefix + '.' + channelName;

            await this.adapter.setObjectNotExistsAsync(channelId, {
                type: 'channel',
                common: { name: channelName.charAt(0).toUpperCase() + channelName.slice(1) },
                native: {},
            });

            for (const [stateName, def] of Object.entries(states)) {
                const stateId = channelId + '.' + stateName;
                const common = {
                    name: stateName,
                    type: def.type,
                    role: def.role,
                    read: def.read,
                    write: def.write,
                    def: def.def,
                };
                if (def.unit) common.unit = def.unit;
                if (def.min !== undefined) common.min = def.min;
                if (def.max !== undefined) common.max = def.max;
                if (def.states) common.states = def.states;

                await this.adapter.setObjectNotExistsAsync(stateId, {
                    type: 'state',
                    common,
                    native: {},
                });
            }
        }
    }

    /**
     * Connect to the device. Tries push updates first, falls back to polling.
     */
    async connect() {
        this.adapter.log.info('Connecting to Apple TV: ' + (this.deviceConfig.name || this.deviceId));

        await this._updateDeviceInfo();

        try {
            this.pushHandle = this.backend.startPushUpdates((event) => {
                this._handlePushEvent(event);
            });
            this.connected = true;
            this.reconnectAttempts = 0;
            await this._setState('info.connected', true);
            this.adapter.log.info('Push updates active for ' + (this.deviceConfig.name || this.deviceId));

            this._startArtworkPolling();
        } catch (err) {
            this.adapter.log.warn(
                'Push updates failed for ' + (this.deviceConfig.name || this.deviceId) +
                ', falling back to polling: ' + err.message
            );
            this._startPolling();
        }
    }

    /**
     * Disconnect from the device. Stops all timers and processes.
     */
    async disconnect() {
        if (this.pushHandle) {
            this.pushHandle.stop();
            this.pushHandle = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.artworkTimer) {
            clearInterval(this.artworkTimer);
            this.artworkTimer = null;
        }
        this.connected = false;
        await this._setState('info.connected', false);
    }

    /**
     * Handle a remote control command.
     */
    async handleRemoteCommand(command) {
        this.adapter.log.debug('Remote command: ' + command + ' -> ' + (this.deviceConfig.name || this.deviceId));
        await this.backend.sendCommand(command);
    }

    /**
     * Handle power state change.
     */
    async handlePowerCommand(turnOn) {
        if (turnOn) {
            await this.backend.turnOn();
        } else {
            await this.backend.turnOff();
        }
    }

    /**
     * Handle seek command.
     */
    async handleSeek(positionSeconds) {
        await this.backend.seekTo(positionSeconds);
    }

    /**
     * Handle app launch command.
     */
    async handleAppLaunch(appId) {
        if (!appId) return;
        this.adapter.log.info('Launching app: ' + appId + ' on ' + (this.deviceConfig.name || this.deviceId));
        await this.backend.launchApp(appId);
    }

    /**
     * Refresh the app list, store it as JSON, and create individual launch buttons.
     */
    async refreshAppList() {
        try {
            const apps = await this.backend.getAppList();
            await this._setState('apps.list', JSON.stringify(apps));

            // Create individual button states for each app
            for (const app of apps) {
                const safeAppName = this._sanitizeAppName(app.name);
                const stateId = this.deviceId + '.apps.' + safeAppName;

                await this.adapter.setObjectNotExistsAsync(stateId, {
                    type: 'state',
                    common: {
                        name: app.name,
                        type: 'boolean',
                        role: 'button',
                        read: false,
                        write: true,
                        def: false,
                    },
                    native: {
                        appId: app.id,
                    },
                });
            }
            this.adapter.log.info('App list refreshed: ' + apps.length + ' apps for ' + (this.deviceConfig.name || this.deviceId));
        } catch (err) {
            this.adapter.log.debug('Failed to refresh app list: ' + err.message);
        }
    }

    /**
     * Launch an app by its sanitized state name (looks up bundle ID from object native).
     */
    async handleAppButton(stateName) {
        const stateId = this.deviceId + '.apps.' + stateName;
        try {
            const obj = await this.adapter.getObjectAsync(stateId);
            const appId = obj && obj.native && obj.native.appId;
            if (appId) {
                this.adapter.log.info('Launching app: ' + (obj.common.name || stateName) + ' (' + appId + ')');
                await this.backend.launchApp(appId);
            } else {
                this.adapter.log.warn('No appId found for state: ' + stateId);
            }
        } catch (err) {
            this.adapter.log.error('Failed to launch app ' + stateName + ': ' + err.message);
        }
    }

    /**
     * Sanitize app name for use as ioBroker state ID.
     */
    _sanitizeAppName(name) {
        return name
            .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    // --- Private methods ---

    _handlePushEvent(event) {
        switch (event.type) {
            case 'playing':
                this._updatePlayingStates(event.data);
                break;
            case 'power':
                this._setState('power.state', event.data.state);
                break;
            case 'volume':
                this._setState('volume.level', event.data.level);
                break;
            case 'connection':
                if (!event.data.connected) {
                    this.adapter.log.warn(
                        'Connection lost for ' + (this.deviceConfig.name || this.deviceId) +
                        ': ' + event.data.reason
                    );
                    this.connected = false;
                    this._setState('info.connected', false);
                    this._scheduleReconnect();
                }
                break;
        }
    }

    async _updatePlayingStates(data) {
        const updates = [
            ['playing.title', data.title],
            ['playing.artist', data.artist],
            ['playing.album', data.album],
            ['playing.genre', data.genre],
            ['playing.mediaType', data.mediaType],
            ['playing.deviceState', data.deviceState],
            ['playing.app', data.app],
            ['playing.appId', data.appId],
            ['playing.position', data.position],
            ['playing.duration', data.duration],
            ['playing.shuffle', data.shuffle],
            ['playing.repeat', data.repeat],
            ['apps.current', data.app],
            ['apps.currentId', data.appId],
        ];

        for (const [path, value] of updates) {
            await this._setState(path, value);
        }
    }

    _startPolling() {
        const interval = ((this.adapter.config && this.adapter.config.pollingInterval) || 10) * 1000;

        this.pollTimer = setInterval(async () => {
            try {
                const playing = await this.backend.getPlaying();
                await this._updatePlayingStates(playing);

                const powerState = await this.backend.getPowerState();
                await this._setState('power.state', powerState);

                if (!this.connected) {
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    await this._setState('info.connected', true);
                }
            } catch (err) {
                this.adapter.log.debug('Poll failed for ' + (this.deviceConfig.name || this.deviceId) + ': ' + err.message);
                if (this.connected) {
                    this.connected = false;
                    await this._setState('info.connected', false);
                }
            }
        }, interval);
    }

    _startArtworkPolling() {
        const artworkInterval = ((this.adapter.config && this.adapter.config.artworkInterval) || 30) * 1000;

        this.artworkTimer = setInterval(async () => {
            try {
                const stateObj = await this.adapter.getStateAsync(
                    this.adapter.namespace + '.' + this.deviceId + '.playing.deviceState'
                );
                if (!stateObj || stateObj.val === 'idle') return;

                const artwork = await this.backend.getArtwork(300, -1);
                if (artwork && artwork.data) {
                    const base64 = 'data:' + artwork.mimetype + ';base64,' + artwork.data.toString('base64');
                    await this._setState('playing.artworkBase64', base64);
                } else {
                    await this._setState('playing.artworkBase64', '');
                }
            } catch (err) {
                this.adapter.log.debug('Artwork fetch failed: ' + err.message);
            }
        }, artworkInterval);
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.adapter.log.error(
                'Max reconnect attempts reached for ' + (this.deviceConfig.name || this.deviceId)
            );
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY
        );
        this.reconnectAttempts++;

        this.adapter.log.info(
            'Reconnecting to ' + (this.deviceConfig.name || this.deviceId) +
            ' in ' + (delay / 1000) + 's (attempt ' + this.reconnectAttempts + ')'
        );

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                await this.disconnect();
                await this.connect();
            } catch (err) {
                this.adapter.log.warn('Reconnect failed: ' + err.message);
                this._scheduleReconnect();
            }
        }, delay);
    }

    async _updateDeviceInfo() {
        try {
            await this._setState('info.name', this.deviceConfig.name || '');
            await this._setState('info.address', this.deviceConfig.address || '');
            await this._setState('info.identifier', this.deviceConfig.identifier || '');
            await this._setState('info.mac', this.deviceConfig.mac || '');
            await this._setState('info.model', this.deviceConfig.modelStr || this.deviceConfig.model || '');
            await this._setState('info.modelId', this.deviceConfig.model || '');
            await this._setState('info.os', this.deviceConfig.os || '');
            await this._setState('info.osVersion', this.deviceConfig.osVersion || '');
            await this._setState('info.paired', !!(
                (this.deviceConfig.airplayCredentials) ||
                (this.deviceConfig.companionCredentials) ||
                (this.deviceConfig.mrpCredentials)
            ));
        } catch (err) {
            this.adapter.log.debug('Failed to update device info: ' + err.message);
        }
    }

    /**
     * Set a state with ack=true under this device's namespace.
     */
    async _setState(statePath, value) {
        await this.adapter.setStateAsync(this.deviceId + '.' + statePath, value, true);
    }
}

module.exports = { DeviceManager };
