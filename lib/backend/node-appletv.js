'use strict';

const { BaseBackend } = require('./base');
const { NODE_KEY_MAP } = require('../constants');

class NodeBackend extends BaseBackend {
    constructor(deviceConfig, log) {
        super(deviceConfig, log);
        this.appletv = null;
        this.connection = null;
        this._cachedPlaying = null;
        this._loadLibrary();
    }

    _loadLibrary() {
        try {
            this.appletv = require('node-appletv-x');
        } catch (_err) {
            this.log.error('node-appletv-x not installed. Install with: npm install node-appletv-x');
        }
    }

    async scan() {
        if (!this.appletv) throw new Error('node-appletv-x not available');
        const devices = await this.appletv.scan();
        return devices.map(dev => ({
            name: dev.name || '',
            address: dev.address || '',
            identifier: dev.uid || '',
            allIdentifiers: [dev.uid],
            mac: '',
            model: '',
            modelStr: '',
            os: '',
            osVersion: '',
            services: [{ protocol: 'mrp', port: dev.port || 0 }],
        }));
    }

    async _ensureConnection() {
        if (this.connection) return;
        if (!this.appletv) throw new Error('node-appletv-x not available');

        const devices = await this.appletv.scan(this.deviceConfig.identifier);
        if (!devices || devices.length === 0) {
            throw new Error('Device ' + this.deviceConfig.identifier + ' not found on network');
        }
        const device = devices[0];

        const credStr = this.deviceConfig.credentials && this.deviceConfig.credentials.mrp;
        if (credStr) {
            const credentials = this.appletv.parseCredentials(credStr);
            this.connection = await device.openConnection(credentials);
        } else {
            this.connection = await device.openConnection();
        }
    }

    async pair(protocol) {
        if (!this.appletv) throw new Error('node-appletv-x not available');
        throw new Error(
            'Pairing with node-appletv-x requires interactive PIN entry. ' +
            'Use the CLI: npx appletv pair'
        );
    }

    async getPlaying() {
        // node-appletv-x uses event-based now playing; return cached state
        return this._cachedPlaying || {
            title: '', artist: '', album: '', genre: '',
            mediaType: 'unknown', deviceState: 'idle',
            app: '', appId: '', position: 0, duration: 0,
            shuffle: 'off', repeat: 'off',
        };
    }

    async sendCommand(command) {
        await this._ensureConnection();
        const keyName = NODE_KEY_MAP[command];
        if (!keyName) {
            throw new Error('Command "' + command + '" not supported by node-appletv-x backend');
        }
        const keyValue = this.appletv.AppleTV.Key[keyName];
        if (keyValue === undefined) {
            throw new Error('Key "' + keyName + '" not found in AppleTV.Key enum');
        }
        await this.connection.sendKeyCommand(keyValue);
    }

    async getPowerState() {
        // node-appletv-x does not have a direct power state API
        // assume on if connected
        try {
            await this._ensureConnection();
            return true;
        } catch (_err) {
            return false;
        }
    }

    async turnOn() {
        // Wake via connect
        await this._ensureConnection();
        this.log.debug('Turn on via connection (wake)');
    }

    async turnOff() {
        await this._ensureConnection();
        // Send suspend key if available
        try {
            await this.connection.sendKeyCommand(this.appletv.AppleTV.Key.Suspend);
        } catch (_err) {
            this.log.warn('Suspend command not supported by this device/library version');
        }
    }

    async seekTo(_positionSeconds) {
        this.log.warn('Seek is not supported by node-appletv-x backend');
    }

    async getAppList() {
        this.log.warn('App list is not supported by node-appletv-x backend');
        return [];
    }

    async launchApp(_appId) {
        this.log.warn('App launching is not supported by node-appletv-x backend');
    }

    async getArtwork(_width, _height) {
        // node-appletv-x does not support artwork retrieval
        return null;
    }

    startPushUpdates(onUpdate) {
        let stopped = false;

        this._ensureConnection().then(() => {
            if (stopped) return;

            this.connection.on('nowPlaying', (info) => {
                if (stopped) return;
                this._cachedPlaying = {
                    title: (info && info.title) || '',
                    artist: (info && info.artist) || '',
                    album: (info && info.album) || '',
                    genre: '',
                    mediaType: 'unknown',
                    deviceState: this._mapNodePlaybackState(info),
                    app: '',
                    appId: '',
                    position: (info && info.elapsed) || 0,
                    duration: (info && info.duration) || 0,
                    shuffle: 'off',
                    repeat: 'off',
                };
                onUpdate({ type: 'playing', data: this._cachedPlaying });
            });

            this.connection.on('close', () => {
                if (stopped) return;
                onUpdate({ type: 'connection', data: { connected: false, reason: 'connection_closed' } });
            });

            this.connection.on('error', (err) => {
                if (stopped) return;
                this.log.error('node-appletv-x connection error: ' + err.message);
                onUpdate({ type: 'connection', data: { connected: false, reason: 'connection_error' } });
            });
        }).catch((err) => {
            this.log.error('Failed to start push updates: ' + err.message);
            onUpdate({ type: 'connection', data: { connected: false, reason: 'connection_failed' } });
        });

        return {
            stop: () => {
                stopped = true;
                if (this.connection) {
                    try {
                        this.connection.removeAllListeners('nowPlaying');
                        this.connection.removeAllListeners('close');
                        this.connection.removeAllListeners('error');
                        this.connection.close();
                    } catch (_err) {
                        // ignore
                    }
                    this.connection = null;
                }
            },
        };
    }

    _mapNodePlaybackState(info) {
        if (!info || !info.playbackState) return 'idle';
        const stateMap = {
            0: 'paused',
            1: 'playing',
            2: 'idle',
        };
        return stateMap[info.playbackState] || 'idle';
    }

    async isReachable() {
        try {
            await this._ensureConnection();
            return true;
        } catch (_err) {
            return false;
        }
    }
}

module.exports = { NodeBackend };
