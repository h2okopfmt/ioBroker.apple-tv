'use strict';

const { BaseStreamingProvider } = require('./base-provider');
const { httpsRequest, parseJsonResponse } = require('./https-helper');

// Known Basic auth for waipu.tv Android client
const WAIPU_BASIC_AUTH = 'Basic YW5kcm9pZENsaWVudDpzdXBlclNlY3JldA==';

class WaipuProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
    }

    get name() { return 'waipu.tv'; }
    get bundleId() { return 'de.exaring.waipu'; }

    /**
     * Authenticate via OAuth2 password grant.
     * POST https://auth.waipu.tv/oauth/token
     */
    async authenticate() {
        const postData = 'grant_type=password'
            + '&username=' + encodeURIComponent(this.config.username)
            + '&password=' + encodeURIComponent(this.config.password);

        const response = await httpsRequest({
            hostname: 'auth.waipu.tv',
            path: '/oauth/token',
            method: 'POST',
            headers: {
                'Authorization': WAIPU_BASIC_AUTH,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
            },
        }, postData);

        const data = parseJsonResponse(response, 'waipu auth');
        this.token = data.access_token;

        if (!this.token) {
            throw new Error('waipu.tv auth: no access_token in response');
        }

        this.log.info('waipu.tv: authenticated successfully');
        return true;
    }

    /**
     * Fetch channel list.
     * GET https://epg.waipu.tv/api/channels
     */
    async fetchChannels() {
        if (!this.token) {
            await this.authenticate();
        }

        const response = await httpsRequest({
            hostname: 'epg.waipu.tv',
            path: '/api/channels',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + this.token,
                'Accept': 'application/vnd.waipu.epg-channels-and-programs-v1+json',
            },
        });

        const data = parseJsonResponse(response, 'waipu channels');

        // The response is an array of channel objects
        const channelArray = Array.isArray(data) ? data : (data.channels || data || []);

        this.channels = channelArray.map(ch => ({
            id: ch.id || ch.stationId || '',
            name: ch.displayName || ch.name || ch.title || '',
        })).filter(ch => ch.name);

        this.log.info('waipu.tv: fetched ' + this.channels.length + ' channels');
        return this.channels;
    }
}

module.exports = { WaipuProvider };
