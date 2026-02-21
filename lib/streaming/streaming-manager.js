'use strict';

const { WaipuProvider } = require('./waipu-provider');

class StreamingManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} log - ioBroker logger
     */
    constructor(adapter, log) {
        this.adapter = adapter;
        this.log = log;
        this.providers = [];
        this.refreshTimer = null;
    }

    /**
     * Initialize providers based on adapter config.
     * @param {object} config - adapter config (this.config)
     */
    init(config) {
        this.providers = [];
        const streaming = config.streaming || {};

        if (streaming.waipuEnabled && streaming.waipuUsername && streaming.waipuPassword) {
            this.providers.push(new WaipuProvider({
                username: streaming.waipuUsername,
                password: streaming.waipuPassword,
            }, this.log));
            this.log.info('Streaming provider registered: waipu.tv');
        }

        // Zattoo provider will be added here later
        // if (streaming.zattooEnabled && streaming.zattooUsername && streaming.zattooPassword) {
        //     this.providers.push(new ZattooProvider({...}, this.log));
        // }

        this.log.info('Streaming manager initialized with ' + this.providers.length + ' provider(s)');
    }

    /**
     * Authenticate all providers and fetch their channel lists.
     * @returns {Promise<Map<string, {providerName: string, channels: Array}>>}
     *          Map keyed by bundle ID
     */
    async refreshAll() {
        const result = new Map();

        for (const provider of this.providers) {
            if (!provider.isConfigured()) continue;

            try {
                await provider.authenticate();
                const channels = await provider.fetchChannels();
                result.set(provider.bundleId, {
                    providerName: provider.name,
                    channels: channels,
                });
                this.log.info('Streaming channels loaded: ' + channels.length + ' from ' + provider.name);
            } catch (err) {
                this.log.warn('Streaming provider ' + provider.name + ' failed: ' + err.message);
            }
        }

        return result;
    }

    /**
     * Start periodic channel refresh.
     * @param {number} intervalSeconds
     * @param {function} callback - Called with Map of channels after each refresh
     */
    startPeriodicRefresh(intervalSeconds, callback) {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }

        const intervalMs = (intervalSeconds || 3600) * 1000;
        this.refreshTimer = setInterval(async () => {
            try {
                const channels = await this.refreshAll();
                if (callback) callback(channels);
            } catch (err) {
                this.log.warn('Periodic streaming refresh failed: ' + err.message);
            }
        }, intervalMs);
    }

    /**
     * Stop all timers.
     */
    stop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}

module.exports = { StreamingManager };
