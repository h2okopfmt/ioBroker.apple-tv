'use strict';

/**
 * Abstract base class for streaming TV providers.
 * Each provider must implement authenticate() and fetchChannels().
 */
class BaseStreamingProvider {
    /**
     * @param {object} config - { username, password, ... }
     * @param {object} log - ioBroker logger
     */
    constructor(config, log) {
        this.config = config;
        this.log = log;
        this.token = null;
        this.channels = [];
    }

    /** Provider display name (e.g. 'waipu.tv') */
    get name() { throw new Error('Not implemented'); }

    /** Apple TV bundle ID (e.g. 'de.exaring.waipu') */
    get bundleId() { throw new Error('Not implemented'); }

    /** Whether credentials are configured */
    isConfigured() {
        return !!(this.config.username && this.config.password);
    }

    /**
     * Authenticate with the service.
     * @returns {Promise<boolean>} true on success
     */
    async authenticate() { throw new Error('Not implemented'); }

    /**
     * Fetch the channel list.
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async fetchChannels() { throw new Error('Not implemented'); }
}

module.exports = { BaseStreamingProvider };
