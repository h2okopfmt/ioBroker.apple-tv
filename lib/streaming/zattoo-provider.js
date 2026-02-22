'use strict';

const { BaseStreamingProvider } = require('./base-provider');
const { httpsRequest, parseJsonResponse, extractCookies } = require('./https-helper');

class ZattooProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
        this.cookies = '';
        this.powerGuideHash = '';
    }

    get name() { return 'Zattoo'; }
    get bundleId() { return 'com.zattoo.player'; }

    /**
     * Authenticate via session-based login.
     * 1. POST /zapi/v3/session/hello  (init session)
     * 2. POST /zapi/v3/account/login  (login with credentials)
     */
    async authenticate() {
        // Step 1: Initialize session
        const helloData = 'client_app_token=web_zattoo_com_150&format=json&lang=de&uuid=web_zattoo_iobroker';

        const helloResp = await httpsRequest({
            hostname: 'zattoo.com',
            path: '/zapi/v3/session/hello',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(helloData),
            },
        }, helloData);

        if (helloResp.statusCode >= 400) {
            throw new Error('Zattoo session/hello failed: HTTP ' + helloResp.statusCode);
        }

        this.cookies = extractCookies(helloResp);

        // Step 2: Login
        const loginData = 'login=' + encodeURIComponent(this.config.username)
            + '&password=' + encodeURIComponent(this.config.password)
            + '&remember=true&format=json';

        const loginResp = await httpsRequest({
            hostname: 'zattoo.com',
            path: '/zapi/v3/account/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(loginData),
                'Cookie': this.cookies,
            },
        }, loginData);

        // Merge cookies from login response
        const loginCookies = extractCookies(loginResp);
        if (loginCookies) {
            this.cookies = loginCookies;
        }

        const loginBody = parseJsonResponse(loginResp, 'Zattoo login');

        if (!loginBody.success && loginResp.statusCode >= 400) {
            throw new Error('Zattoo login failed: ' + (loginBody.message || 'unknown error'));
        }

        // Extract power_guide_hash from session
        this.powerGuideHash = (loginBody.session && loginBody.session.power_guide_hash) || '';

        this.log.info('Zattoo: authenticated successfully');
        return true;
    }

    /**
     * Fetch channel list.
     * GET /zapi/v2/cached/channels/{power_guide_hash}
     */
    async fetchChannels() {
        if (!this.cookies) {
            await this.authenticate();
        }

        const path = this.powerGuideHash
            ? '/zapi/v2/cached/channels/' + this.powerGuideHash + '?details=False'
            : '/zapi/v2/cached/channels?details=False';

        const response = await httpsRequest({
            hostname: 'zattoo.com',
            path: path,
            method: 'GET',
            headers: {
                'Cookie': this.cookies,
                'Accept': 'application/json',
            },
        });

        const data = parseJsonResponse(response, 'Zattoo channels');

        const channelList = (data.channel_groups || []).reduce((acc, group) => {
            if (group.channels && Array.isArray(group.channels)) {
                for (const ch of group.channels) {
                    acc.push({
                        id: ch.cid || ch.id || '',
                        name: ch.title || ch.display_alias || ch.cid || '',
                    });
                }
            }
            return acc;
        }, []);

        // Fallback: if channels are flat array
        if (channelList.length === 0 && Array.isArray(data.channels)) {
            for (const ch of data.channels) {
                channelList.push({
                    id: ch.cid || ch.id || '',
                    name: ch.title || ch.display_alias || ch.cid || '',
                });
            }
        }

        this.channels = channelList.filter(ch => ch.name);
        this.log.info('Zattoo: fetched ' + this.channels.length + ' channels');
        return this.channels;
    }
}

module.exports = { ZattooProvider };
