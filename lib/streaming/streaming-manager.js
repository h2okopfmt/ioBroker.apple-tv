'use strict';

const { WaipuProvider } = require('./waipu-provider');
const { ZattooProvider } = require('./zattoo-provider');
const { PlutoTvProvider } = require('./plutotv-provider');
const { MagentaTvProvider } = require('./magentatv-provider');
const { JoynProvider } = require('./joyn-provider');
const { ArdProvider, ZdfProvider, ArteProvider } = require('./public-tv-provider');

/**
 * Map of provider key -> { class, needsCredentials }
 */
const PROVIDER_REGISTRY = {
    waipu:     { cls: WaipuProvider,     needsCredentials: true },
    zattoo:    { cls: ZattooProvider,    needsCredentials: true },
    plutoTv:   { cls: PlutoTvProvider,   needsCredentials: false },
    magentaTv: { cls: MagentaTvProvider, needsCredentials: false },
    joyn:      { cls: JoynProvider,      needsCredentials: false },
    ard:       { cls: ArdProvider,       needsCredentials: false },
    zdf:       { cls: ZdfProvider,       needsCredentials: false },
    arte:      { cls: ArteProvider,      needsCredentials: false },
};

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

        // waipu.tv - requires credentials
        if (streaming.waipuEnabled && streaming.waipuUsername && streaming.waipuPassword) {
            this.providers.push(new WaipuProvider({
                username: streaming.waipuUsername,
                password: streaming.waipuPassword,
            }, this.log));
            this.log.info('Streaming provider registered: waipu.tv');
        }

        // Zattoo - requires credentials
        if (streaming.zattooEnabled && streaming.zattooUsername && streaming.zattooPassword) {
            this.providers.push(new ZattooProvider({
                username: streaming.zattooUsername,
                password: streaming.zattooPassword,
            }, this.log));
            this.log.info('Streaming provider registered: Zattoo');
        }

        // Pluto TV - free, no credentials
        if (streaming.plutoTvEnabled) {
            this.providers.push(new PlutoTvProvider({}, this.log));
            this.log.info('Streaming provider registered: Pluto TV');
        }

        // MagentaTV - anonymous session for channel list
        if (streaming.magentaTvEnabled) {
            this.providers.push(new MagentaTvProvider({
                username: streaming.magentaTvUsername || '',
                password: streaming.magentaTvPassword || '',
            }, this.log));
            this.log.info('Streaming provider registered: MagentaTV');
        }

        // Joyn - free channel list
        if (streaming.joynEnabled) {
            this.providers.push(new JoynProvider({}, this.log));
            this.log.info('Streaming provider registered: Joyn');
        }

        // ARD Mediathek - static channel list
        if (streaming.ardEnabled) {
            this.providers.push(new ArdProvider({}, this.log));
            this.log.info('Streaming provider registered: ARD Mediathek');
        }

        // ZDF Mediathek - static channel list
        if (streaming.zdfEnabled) {
            this.providers.push(new ZdfProvider({}, this.log));
            this.log.info('Streaming provider registered: ZDF Mediathek');
        }

        // ARTE - static channel list
        if (streaming.arteEnabled) {
            this.providers.push(new ArteProvider({}, this.log));
            this.log.info('Streaming provider registered: ARTE');
        }

        this.log.info('Streaming manager initialized with ' + this.providers.length + ' provider(s)');
    }

    /**
     * Test a single provider: authenticate + fetch channels.
     * @param {string} providerKey - e.g. 'waipu', 'zattoo', 'plutoTv', etc.
     * @param {object} credentials - { username, password } (if needed)
     * @returns {Promise<{success: boolean, channels: number, error?: string}>}
     */
    async testProvider(providerKey, credentials) {
        const entry = PROVIDER_REGISTRY[providerKey];
        if (!entry) {
            return { success: false, channels: 0, error: 'Unknown provider: ' + providerKey };
        }

        try {
            const provider = new entry.cls(credentials || {}, this.log);

            await provider.authenticate();
            const channels = await provider.fetchChannels();

            return {
                success: true,
                channels: channels.length,
                providerName: provider.name,
            };
        } catch (err) {
            return {
                success: false,
                channels: 0,
                error: err.message,
            };
        }
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

module.exports = { StreamingManager, PROVIDER_REGISTRY };
