'use strict';

/**
 * Abstract base class defining the interface all backends must implement.
 * Provides a contract ensuring pyatv and node-appletv-x are interchangeable.
 */
class BaseBackend {
    /**
     * @param {object} deviceConfig - { identifier, address, credentials: { mrp, airplay, companion } }
     * @param {object} log - ioBroker logger
     */
    constructor(deviceConfig, log) {
        this.deviceConfig = deviceConfig;
        this.log = log;
    }

    /**
     * Scan for Apple TV devices on the network.
     * @returns {Promise<Array<{name, address, identifier, mac, model, modelStr, os, osVersion, services}>>}
     */
    async scan() {
        throw new Error('Not implemented');
    }

    /**
     * Initiate pairing with a protocol.
     * @param {string} protocol - 'companion', 'airplay', 'raop'
     * @returns {Promise<{credentials: string, protocol: string}>}
     */
    async pair(protocol) {
        throw new Error('Not implemented');
    }

    /**
     * Get current now-playing information.
     * @returns {Promise<{title, artist, album, genre, mediaType, deviceState, app, appId, position, duration, shuffle, repeat}>}
     */
    async getPlaying() {
        throw new Error('Not implemented');
    }

    /**
     * Send a remote control command.
     * @param {string} command - e.g., 'play', 'pause', 'menu', 'up', 'select'
     * @returns {Promise<void>}
     */
    async sendCommand(command) {
        throw new Error('Not implemented');
    }

    /**
     * Get power state.
     * @returns {Promise<boolean>} true = on, false = off
     */
    async getPowerState() {
        throw new Error('Not implemented');
    }

    /**
     * Turn device on.
     * @returns {Promise<void>}
     */
    async turnOn() {
        throw new Error('Not implemented');
    }

    /**
     * Turn device off.
     * @returns {Promise<void>}
     */
    async turnOff() {
        throw new Error('Not implemented');
    }

    /**
     * Seek to a position in the current media.
     * @param {number} positionSeconds
     * @returns {Promise<void>}
     */
    async seekTo(positionSeconds) {
        throw new Error('Not implemented');
    }

    /**
     * Get the list of installed/available apps.
     * @returns {Promise<Array<{name: string, id: string}>>}
     */
    async getAppList() {
        throw new Error('Not implemented');
    }

    /**
     * Launch an app by bundle ID.
     * @param {string} appId - e.g., 'com.netflix.Netflix'
     * @returns {Promise<void>}
     */
    async launchApp(appId) {
        throw new Error('Not implemented');
    }

    /**
     * Fetch artwork for the currently playing media.
     * @param {number} [width=300]
     * @param {number} [height=-1]
     * @returns {Promise<{data: Buffer, mimetype: string} | null>}
     */
    async getArtwork(width, height) {
        throw new Error('Not implemented');
    }

    /**
     * Start push updates (long-running subprocess or event listener).
     * @param {function} onUpdate - Called with { type: 'playing'|'power'|'volume'|'connection', data: {...} }
     * @returns {{ stop: function }} Object with stop() method to terminate
     */
    startPushUpdates(onUpdate) {
        throw new Error('Not implemented');
    }

    /**
     * Check if device is reachable.
     * @returns {Promise<boolean>}
     */
    async isReachable() {
        throw new Error('Not implemented');
    }
}

module.exports = { BaseBackend };
