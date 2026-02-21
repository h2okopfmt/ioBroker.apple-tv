'use strict';

const { PyatvBackend } = require('./pyatv');
const { NodeBackend } = require('./node-appletv');

class BackendFactory {
    /**
     * @param {string} backendType - 'pyatv' or 'node-appletv-x'
     * @param {object} log - ioBroker logger
     */
    constructor(backendType, log) {
        this.backendType = backendType;
        this.log = log;
    }

    /**
     * Create a new backend instance for a specific device.
     * @param {object} deviceConfig
     * @returns {import('./base').BaseBackend}
     */
    create(deviceConfig) {
        switch (this.backendType) {
            case 'pyatv':
                return new PyatvBackend(deviceConfig, this.log);
            case 'node-appletv-x':
                return new NodeBackend(deviceConfig, this.log);
            default:
                throw new Error('Unknown backend type: ' + this.backendType);
        }
    }
}

module.exports = { BackendFactory };
