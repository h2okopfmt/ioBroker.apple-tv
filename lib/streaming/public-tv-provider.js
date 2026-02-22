'use strict';

const { BaseStreamingProvider } = require('./base-provider');

/**
 * Public broadcaster channels (ARD, ZDF, ARTE).
 * These have publicly accessible live streams - no auth required.
 * We provide static channel lists since the lineup rarely changes.
 */

class ArdProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
    }

    get name() { return 'ARD Mediathek'; }
    get bundleId() { return 'de.swr.avp.ard.tablet'; }

    isConfigured() { return true; }
    async authenticate() { return true; }

    async fetchChannels() {
        this.channels = [
            { id: 'das-erste', name: 'Das Erste' },
            { id: 'br-fernsehen', name: 'BR Fernsehen' },
            { id: 'hr-fernsehen', name: 'hr-fernsehen' },
            { id: 'mdr-fernsehen', name: 'MDR Fernsehen' },
            { id: 'ndr-fernsehen', name: 'NDR Fernsehen' },
            { id: 'radio-bremen-tv', name: 'Radio Bremen TV' },
            { id: 'rbb-fernsehen', name: 'rbb Fernsehen' },
            { id: 'sr-fernsehen', name: 'SR Fernsehen' },
            { id: 'swr-fernsehen', name: 'SWR Fernsehen' },
            { id: 'wdr-fernsehen', name: 'WDR Fernsehen' },
            { id: 'one', name: 'ONE' },
            { id: 'tagesschau24', name: 'tagesschau24' },
            { id: 'ard-alpha', name: 'ARD-alpha' },
            { id: 'kika', name: 'KiKA' },
            { id: 'phoenix', name: 'phoenix' },
            { id: '3sat', name: '3sat' },
        ];
        this.log.info('ARD: ' + this.channels.length + ' channels');
        return this.channels;
    }
}

class ZdfProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
    }

    get name() { return 'ZDF Mediathek'; }
    get bundleId() { return 'de.zdf.mediathek.universal'; }

    isConfigured() { return true; }
    async authenticate() { return true; }

    async fetchChannels() {
        this.channels = [
            { id: 'zdf', name: 'ZDF' },
            { id: 'zdfneo', name: 'ZDFneo' },
            { id: 'zdfinfo', name: 'ZDFinfo' },
            { id: '3sat', name: '3sat' },
            { id: 'kika', name: 'KiKA' },
            { id: 'phoenix', name: 'phoenix' },
        ];
        this.log.info('ZDF: ' + this.channels.length + ' channels');
        return this.channels;
    }
}

class ArteProvider extends BaseStreamingProvider {
    constructor(config, log) {
        super(config, log);
    }

    get name() { return 'ARTE'; }
    get bundleId() { return 'tv.arte.plus7'; }

    isConfigured() { return true; }
    async authenticate() { return true; }

    async fetchChannels() {
        this.channels = [
            { id: 'arte-de', name: 'ARTE DE' },
            { id: 'arte-fr', name: 'ARTE FR' },
        ];
        this.log.info('ARTE: ' + this.channels.length + ' channels');
        return this.channels;
    }
}

module.exports = { ArdProvider, ZdfProvider, ArteProvider };
