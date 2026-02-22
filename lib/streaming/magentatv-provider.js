'use strict';

const { BaseStreamingProvider } = require('./base-provider');
const { httpsRequest, parseJsonResponse, extractCookies } = require('./https-helper');

/**
 * MagentaTV (Deutsche Telekom) - Live TV streaming.
 * Uses anonymous session for channel list (no Telekom credentials needed for list).
 * User credentials optional - only needed for actual streaming.
 */
class MagentaTvProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
        this.cookies = '';
        this.csrfToken = '';
    }

    get name() { return 'MagentaTV'; }
    get bundleId() { return 'de.telekom.entertaintv'; }

    /** MagentaTV can work without credentials (anonymous session for channel list) */
    isConfigured() { return true; }

    /**
     * Authenticate - create anonymous session with CSRF token.
     * POST https://api.prod.sngtv.magentatv.de/EPG/JSON/Authenticate
     */
    async authenticate() {
        const authBody = JSON.stringify({
            terminalid: 'iobroker_appletv_' + Date.now(),
            mac: '00:00:00:00:00:00',
            terminaltype: 'WEBTV',
            utcEnable: 1,
            timezone: 'Europe/Berlin',
            userType: 3,
            terminalvendor: 'Unknown',
        });

        const response = await httpsRequest({
            hostname: 'api.prod.sngtv.magentatv.de',
            path: '/EPG/JSON/Authenticate?SID=firstup&T=Windows_chrome_118',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(authBody),
                'Accept': 'application/json',
            },
        }, authBody);

        if (response.statusCode >= 400) {
            throw new Error('MagentaTV auth failed: HTTP ' + response.statusCode);
        }

        this.cookies = extractCookies(response);

        const data = parseJsonResponse(response, 'MagentaTV auth');

        // Extract CSRF token
        this.csrfToken = data.csrfToken || data.token || '';
        if (!this.csrfToken && data.retmsg === 'ok') {
            // Some responses have it nested
            this.csrfToken = (data.data && data.data.csrfToken) || '';
        }

        this.log.info('MagentaTV: session created');
        return true;
    }

    /**
     * Fetch channel list.
     * POST https://api.prod.sngtv.magentatv.de/EPG/JSON/AllChannel
     */
    async fetchChannels() {
        if (!this.cookies) {
            await this.authenticate();
        }

        const body = JSON.stringify({
            channelNamespace: 2,
            filterlist: [{ key: 'IsHide', value: '-1' }],
            metaDataVer: '0',
            properties: [
                { include: 'name,channelId,externalCode,pictures,logo' }
            ],
            returnSatChannel: 0,
        });

        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Accept': 'application/json',
            'Cookie': this.cookies,
        };

        if (this.csrfToken) {
            headers['X_CSRFTOKEN'] = this.csrfToken;
        }

        const response = await httpsRequest({
            hostname: 'api.prod.sngtv.magentatv.de',
            path: '/EPG/JSON/AllChannel',
            method: 'POST',
            headers: headers,
        }, body);

        const data = parseJsonResponse(response, 'MagentaTV channels');

        const channelArray = data.channellist || data.channels || [];

        this.channels = channelArray.map(ch => ({
            id: ch.channelId || ch.contentId || '',
            name: ch.name || ch.channelName || '',
        })).filter(ch => ch.name);

        this.log.info('MagentaTV: fetched ' + this.channels.length + ' channels');
        return this.channels;
    }
}

module.exports = { MagentaTvProvider };
