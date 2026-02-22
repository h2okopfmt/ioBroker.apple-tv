'use strict';

const { BaseStreamingProvider } = require('./base-provider');
const { httpsRequest, parseJsonResponse } = require('./https-helper');

/**
 * Pluto TV - Free ad-supported streaming TV.
 * No authentication required! Public API.
 */
class PlutoTvProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
    }

    get name() { return 'Pluto TV'; }
    get bundleId() { return 'tv.pluto.ios'; }

    /** No auth needed for Pluto TV */
    isConfigured() { return true; }

    /** No authentication required */
    async authenticate() {
        this.log.info('Pluto TV: no authentication required (free service)');
        return true;
    }

    /**
     * Fetch channel list from public API.
     * GET https://api.pluto.tv/v2/channels.json
     */
    async fetchChannels() {
        const response = await httpsRequest({
            hostname: 'api.pluto.tv',
            path: '/v2/channels.json',
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });

        const data = parseJsonResponse(response, 'Pluto TV channels');

        const channelArray = Array.isArray(data) ? data : [];

        this.channels = channelArray
            .filter(ch => ch.isStitched !== false && ch.visibility !== 'hidden')
            .map(ch => ({
                id: ch.slug || ch._id || '',
                name: ch.name || ch.title || '',
            }))
            .filter(ch => ch.name);

        this.log.info('Pluto TV: fetched ' + this.channels.length + ' channels');
        return this.channels;
    }
}

module.exports = { PlutoTvProvider };
