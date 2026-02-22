'use strict';

const { BaseStreamingProvider } = require('./base-provider');
const { httpsRequest, parseJsonResponse } = require('./https-helper');

/**
 * Joyn (ProSiebenSat.1) - Free live TV streaming.
 * Uses public API key (no user credentials needed for channel list).
 */
class JoynProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
        this.apiKey = '';
    }

    get name() { return 'Joyn'; }
    get bundleId() { return 'de.prosiebensat1digital.seventv'; }

    /** Joyn can work without user credentials for channel list */
    isConfigured() { return true; }

    /**
     * Fetch API key from Joyn web frontend.
     */
    async authenticate() {
        // Try to extract API key from Joyn main page
        try {
            const response = await httpsRequest({
                hostname: 'www.joyn.de',
                path: '/play/live-tv',
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html',
                },
            });

            if (response.body) {
                // Look for x-api-key in the page source
                const apiKeyMatch = response.body.match(/x-api-key['":\s]+([a-zA-Z0-9_-]{20,})/i);
                if (apiKeyMatch) {
                    this.apiKey = apiKeyMatch[1];
                    this.log.info('Joyn: API key extracted');
                }
            }
        } catch (err) {
            this.log.debug('Joyn: could not extract API key from web: ' + err.message);
        }

        // Fallback: use known API key (may change with frontend updates)
        if (!this.apiKey) {
            this.apiKey = 'AY2UEzfFjBbXMIiNx9IuafFNsdmX19yg3BGUbMgp';
            this.log.debug('Joyn: using fallback API key');
        }

        this.log.info('Joyn: ready');
        return true;
    }

    /**
     * Fetch live TV channels via GraphQL API.
     */
    async fetchChannels() {
        if (!this.apiKey) {
            await this.authenticate();
        }

        // Use a simple compilation query for live TV channels
        const query = JSON.stringify({
            operationName: 'LiveTvChannels',
            query: `query LiveTvChannels {
                channels: compilationBySlug(slug: "live-tv", type: PAGE) {
                    ... on Page {
                        lanes {
                            ... on Lane {
                                items {
                                    ... on Teaser {
                                        title
                                        id
                                        path
                                    }
                                }
                            }
                        }
                    }
                }
            }`,
            variables: {},
        });

        try {
            const response = await httpsRequest({
                hostname: 'api.joyn.de',
                path: '/graphql',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(query),
                    'x-api-key': this.apiKey,
                    'Joyn-Platform': 'web',
                },
            }, query);

            const data = parseJsonResponse(response, 'Joyn channels');

            // Try to parse from GraphQL response
            const channels = [];
            const compilationData = data.data && data.data.channels;

            if (compilationData && compilationData.lanes) {
                for (const lane of compilationData.lanes) {
                    if (lane.items) {
                        for (const item of lane.items) {
                            if (item.title) {
                                channels.push({
                                    id: item.id || item.path || '',
                                    name: item.title,
                                });
                            }
                        }
                    }
                }
            }

            if (channels.length > 0) {
                this.channels = channels;
            } else {
                // Fallback: well-known Joyn live TV channels
                this.channels = this._getStaticChannelList();
                this.log.debug('Joyn: using static channel list (API response format changed)');
            }
        } catch (err) {
            this.log.warn('Joyn: API call failed, using static channel list: ' + err.message);
            this.channels = this._getStaticChannelList();
        }

        this.log.info('Joyn: fetched ' + this.channels.length + ' channels');
        return this.channels;
    }

    /**
     * Static fallback channel list for Joyn free live TV.
     */
    _getStaticChannelList() {
        return [
            { id: 'das-erste', name: 'Das Erste' },
            { id: 'zdf', name: 'ZDF' },
            { id: 'rtl', name: 'RTL' },
            { id: 'sat1', name: 'SAT.1' },
            { id: 'prosieben', name: 'ProSieben' },
            { id: 'vox', name: 'VOX' },
            { id: 'rtl2', name: 'RTL II' },
            { id: 'kabel-eins', name: 'kabel eins' },
            { id: 'sixx', name: 'sixx' },
            { id: 'sat1-gold', name: 'SAT.1 Gold' },
            { id: 'prosieben-maxx', name: 'ProSieben MAXX' },
            { id: 'kabel-eins-doku', name: 'kabel eins Doku' },
            { id: 'tele5', name: 'TELE 5' },
            { id: 'sport1', name: 'SPORT1' },
            { id: 'ntv', name: 'ntv' },
            { id: 'welt', name: 'WELT' },
            { id: 'zdfneo', name: 'ZDFneo' },
            { id: 'zdfinfo', name: 'ZDFinfo' },
            { id: 'one', name: 'ONE' },
            { id: 'arte', name: 'ARTE' },
            { id: 'phoenix', name: 'phoenix' },
            { id: '3sat', name: '3sat' },
            { id: 'kika', name: 'KiKA' },
            { id: 'tagesschau24', name: 'tagesschau24' },
            { id: 'ard-alpha', name: 'ARD-alpha' },
            { id: 'nitro', name: 'NITRO' },
            { id: 'super-rtl', name: 'SUPER RTL' },
            { id: 'toggo-plus', name: 'TOGGO plus' },
            { id: 'rtl-up', name: 'RTLup' },
            { id: 'comedy-central', name: 'Comedy Central' },
            { id: 'nickelodeon', name: 'Nickelodeon' },
            { id: 'mtv', name: 'MTV' },
            { id: 'deluxe-music', name: 'DELUXE MUSIC' },
            { id: 'bibel-tv', name: 'Bibel TV' },
            { id: 'qvc', name: 'QVC' },
            { id: 'hse', name: 'HSE' },
        ];
    }
}

module.exports = { JoynProvider };
