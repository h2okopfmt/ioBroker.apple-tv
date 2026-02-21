'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BaseBackend } = require('./base');
const { PYATV_COMMAND_MAP, ATVSCRIPT_TIMEOUT, ATVSCRIPT_SCAN_TIMEOUT } = require('../constants');

// Common paths where pyatv binaries are installed on Linux/macOS
const SEARCH_PATHS = [
    '/usr/local/bin',
    '/usr/bin',
    '/home/iobroker/.local/bin',
    '/root/.local/bin',
    '/opt/iobroker/.local/bin',
    '/snap/bin',
];

// Also search in any user's .local/bin
function findBinary(name) {
    const fs = require('fs');
    // First: check all known paths
    for (const dir of SEARCH_PATHS) {
        const fullPath = dir + '/' + name;
        try {
            fs.accessSync(fullPath, fs.constants.X_OK);
            return fullPath;
        } catch (_e) {
            // not found here
        }
    }
    // Second: scan /home/*/.local/bin/
    try {
        const homes = fs.readdirSync('/home');
        for (const user of homes) {
            const fullPath = '/home/' + user + '/.local/bin/' + name;
            try {
                fs.accessSync(fullPath, fs.constants.X_OK);
                return fullPath;
            } catch (_e) {
                // not found
            }
        }
    } catch (_e) {
        // /home not readable
    }
    // Fallback: just the name (rely on PATH)
    return name;
}

class PyatvBackend extends BaseBackend {
    constructor(deviceConfig, log) {
        super(deviceConfig, log);
        this.atvscriptPath = deviceConfig.atvscriptPath || findBinary('atvscript');
        this.atvremotePath = deviceConfig.atvremotePath || findBinary('atvremote');
        this._pairProcess = null;
        if (log && log.debug) {
            log.debug('atvscript path: ' + this.atvscriptPath);
            log.debug('atvremote path: ' + this.atvremotePath);
        }
    }

    /**
     * Build common args for atvscript targeting this device.
     */
    _buildDeviceArgs() {
        const args = [];
        if (this.deviceConfig.identifier) {
            args.push('--id', this.deviceConfig.identifier);
        } else if (this.deviceConfig.address) {
            args.push('-s', this.deviceConfig.address);
        }
        const creds = this.deviceConfig.credentials || {};
        if (creds.mrp) args.push('--mrp-credentials', creds.mrp);
        if (creds.airplay) args.push('--airplay-credentials', creds.airplay);
        if (creds.companion) args.push('--companion-credentials', creds.companion);
        return args;
    }

    /**
     * Execute atvscript with given args, parse JSON response.
     */
    _execAtvscript(args, timeout) {
        timeout = timeout || ATVSCRIPT_TIMEOUT;
        return new Promise((resolve, reject) => {
            execFile(this.atvscriptPath, args, {
                timeout,
                maxBuffer: 1024 * 1024,
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error('atvscript failed: ' + error.message + (stderr ? '. stderr: ' + stderr : '')));
                    return;
                }
                try {
                    const result = JSON.parse(stdout.trim());
                    if (result.result === 'failure') {
                        reject(new Error('atvscript error: ' + (result.error || result.exception || 'unknown')));
                        return;
                    }
                    resolve(result);
                } catch (parseErr) {
                    reject(new Error('Failed to parse atvscript output: ' + parseErr.message + '. Raw: ' + stdout.substring(0, 200)));
                }
            });
        });
    }

    /**
     * Execute atvremote with given args (for non-JSON commands).
     */
    _execAtvremote(args, timeout) {
        timeout = timeout || ATVSCRIPT_TIMEOUT;
        return new Promise((resolve, reject) => {
            execFile(this.atvremotePath, args, {
                timeout,
                maxBuffer: 1024 * 1024,
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error('atvremote failed: ' + error.message + (stderr ? '. stderr: ' + stderr : '')));
                    return;
                }
                resolve(stdout);
            });
        });
    }

    /**
     * Check if pyatv is installed on the system.
     * Searches common install paths, not just PATH.
     * @returns {Promise<boolean>}
     */
    static checkInstalled() {
        const atvscriptPath = findBinary('atvscript');
        // If findBinary returned a full path (not just the name), the file exists and is executable
        if (atvscriptPath !== 'atvscript') {
            return Promise.resolve(true);
        }
        const atvremotePath = findBinary('atvremote');
        if (atvremotePath !== 'atvremote') {
            return Promise.resolve(true);
        }
        // Fallback: try executing (maybe it's in PATH)
        return new Promise((resolve) => {
            execFile('atvscript', ['scan', '--help'], { timeout: 5000 }, (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Attempt to auto-install pyatv.
     * Tries in order:
     *   1. pip3 install pyatv --break-system-packages
     *   2. pip3 install pyatv (without flag, older systems)
     *   3. apt install python3-pip, then retry pip3
     *   4. pip install pyatv --break-system-packages
     * @param {object} log - logger
     * @returns {Promise<boolean>} true if install succeeded
     */
    static installPyatv(log) {
        const execOpts = { timeout: 180000, maxBuffer: 2 * 1024 * 1024 };

        const tryExec = (cmd, args) => {
            return new Promise((resolve) => {
                log.info('Trying: ' + cmd + ' ' + args.join(' '));
                execFile(cmd, args, execOpts, (error, stdout, stderr) => {
                    if (error) {
                        log.debug(cmd + ' failed: ' + (stderr || error.message));
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            });
        };

        return (async () => {
            // Step 1: Try pip3 with --break-system-packages (Debian 12+, Ubuntu 23+)
            log.info('Attempting to install pyatv automatically...');
            if (await tryExec('pip3', ['install', 'pyatv', '--break-system-packages'])) {
                log.info('pyatv installed successfully via pip3 (--break-system-packages)');
                return true;
            }

            // Step 2: Try pip3 without flag (older systems)
            if (await tryExec('pip3', ['install', 'pyatv'])) {
                log.info('pyatv installed successfully via pip3');
                return true;
            }

            // Step 3: pip3 not found? Install python3-pip via apt first
            log.info('pip3 not found or failed, trying to install python3-pip via apt...');
            await tryExec('apt-get', ['update', '-qq']);
            if (await tryExec('apt-get', ['install', '-y', 'python3-pip', 'python3-venv'])) {
                log.info('python3-pip installed, retrying pyatv install...');
                if (await tryExec('pip3', ['install', 'pyatv', '--break-system-packages'])) {
                    log.info('pyatv installed successfully after apt install python3-pip');
                    return true;
                }
                if (await tryExec('pip3', ['install', 'pyatv'])) {
                    log.info('pyatv installed successfully after apt install python3-pip');
                    return true;
                }
            }

            // Step 4: Last resort - try pip (without the "3")
            if (await tryExec('pip', ['install', 'pyatv', '--break-system-packages'])) {
                log.info('pyatv installed successfully via pip');
                return true;
            }

            log.error('pyatv auto-install failed. Please install manually: sudo pip3 install pyatv --break-system-packages');
            return false;
        })();
    }

    async scan() {
        const result = await this._execAtvscript(['scan'], ATVSCRIPT_SCAN_TIMEOUT);
        return (result.devices || []).map(dev => ({
            name: dev.name || '',
            address: dev.address || '',
            identifier: dev.identifier || '',
            allIdentifiers: dev.all_identifiers || [],
            mac: (dev.device_info && dev.device_info.mac) || '',
            model: (dev.device_info && dev.device_info.model) || '',
            modelStr: (dev.device_info && dev.device_info.model_str) || '',
            os: (dev.device_info && dev.device_info.operating_system) || '',
            osVersion: (dev.device_info && dev.device_info.version) || '',
            services: (dev.services || []).map(s => ({
                protocol: s.protocol || '',
                port: s.port || 0,
            })),
        }));
    }

    /**
     * Start the pairing process. This spawns atvremote pair as a subprocess
     * and waits for it to prompt for a PIN. Returns 'awaitingPin' status.
     *
     * @param {string} protocol - 'airplay' or 'companion'
     * @returns {Promise<{status: string}>}
     */
    async pairStart(protocol) {
        // Kill any existing pair process
        this.pairAbort();

        const args = [];
        if (this.deviceConfig.identifier) {
            args.push('--id', this.deviceConfig.identifier);
        } else if (this.deviceConfig.address) {
            args.push('-s', this.deviceConfig.address);
        }
        args.push('--protocol', protocol || 'airplay');
        args.push('pair');

        return new Promise((resolve, reject) => {
            let output = '';
            let resolved = false;

            this._pairProcess = spawn(this.atvremotePath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.pairAbort();
                    reject(new Error('Pairing timeout: Apple TV did not respond within 30 seconds'));
                }
            }, 30000);

            this._pairProcess.stdout.on('data', (chunk) => {
                output += chunk.toString();
                // atvremote outputs "Enter PIN on screen:" or similar when ready
                if (!resolved && (output.includes('Enter PIN') || output.includes('pin:'))) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve({ status: 'awaitingPin' });
                }
            });

            this._pairProcess.stderr.on('data', (chunk) => {
                output += chunk.toString();
                // Some versions output the PIN prompt on stderr
                if (!resolved && (output.includes('Enter PIN') || output.includes('pin:'))) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve({ status: 'awaitingPin' });
                }
            });

            this._pairProcess.on('error', (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Failed to start pairing: ' + err.message));
                }
            });

            this._pairProcess.on('exit', (code) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    // Process exited before we got a PIN prompt
                    if (output.includes('credentials:') || output.includes('Credentials:')) {
                        // Some devices pair without PIN
                        const credentials = this._extractCredentials(output);
                        resolve({ status: 'paired', credentials });
                    } else {
                        reject(new Error('Pairing failed (exit code ' + code + '): ' + output.substring(0, 300)));
                    }
                }
            });
        });
    }

    /**
     * Submit the PIN code to the running pair process.
     *
     * @param {string} pin - The 4-digit PIN shown on the Apple TV screen
     * @returns {Promise<{status: string, credentials: string}>}
     */
    async pairFinish(pin) {
        if (!this._pairProcess || this._pairProcess.killed) {
            throw new Error('No active pairing process. Start pairing first.');
        }

        return new Promise((resolve, reject) => {
            let output = '';
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.pairAbort();
                    reject(new Error('Pairing PIN verification timeout'));
                }
            }, 30000);

            // Collect all further output
            const onData = (chunk) => {
                output += chunk.toString();
            };
            this._pairProcess.stdout.on('data', onData);
            this._pairProcess.stderr.on('data', onData);

            this._pairProcess.on('exit', (code) => {
                clearTimeout(timeout);
                if (resolved) return;
                resolved = true;
                this._pairProcess = null;

                // Extract credentials from the output
                const credentials = this._extractCredentials(output);
                if (credentials) {
                    resolve({ status: 'paired', credentials });
                } else if (code === 0) {
                    // Successful but no credentials found in output
                    resolve({ status: 'paired', credentials: output.trim() });
                } else {
                    reject(new Error('Pairing failed after PIN entry (exit code ' + code + '): ' + output.substring(0, 300)));
                }
            });

            // Send the PIN to stdin
            try {
                this._pairProcess.stdin.write(pin + '\n');
            } catch (err) {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Failed to send PIN: ' + err.message));
                }
            }
        });
    }

    /**
     * Abort any running pairing process.
     */
    pairAbort() {
        if (this._pairProcess && !this._pairProcess.killed) {
            try {
                this._pairProcess.kill('SIGTERM');
            } catch (_err) {
                // already dead
            }
            this._pairProcess = null;
        }
    }

    /**
     * Extract credentials string from atvremote output.
     */
    _extractCredentials(output) {
        // Look for patterns like:
        // "credentials: XXXX:YYYY:ZZZZ" or
        // "Credentials: XXXX" or
        // the entire last non-empty line if it looks like credentials
        const lines = output.split('\n').map(l => l.trim()).filter(l => l);
        for (const line of lines) {
            // Match "credentials:" prefix
            const match = line.match(/[Cc]redentials?:\s*(.+)/);
            if (match) {
                return match[1].trim();
            }
        }
        // Fallback: if the last non-empty line looks like a credential string
        // (hex chars separated by colons)
        for (let i = lines.length - 1; i >= 0; i--) {
            if (/^[0-9a-fA-F:]+$/.test(lines[i]) && lines[i].length > 20) {
                return lines[i];
            }
        }
        return null;
    }

    // Legacy pair() interface - now throws with instructions
    async pair(_protocol) {
        throw new Error('Use pairStart() and pairFinish() for interactive pairing');
    }

    async getPlaying() {
        const args = [...this._buildDeviceArgs(), 'playing'];
        const result = await this._execAtvscript(args);
        return {
            title: result.title || '',
            artist: result.artist || '',
            album: result.album || '',
            genre: result.genre || '',
            mediaType: (result.media_type || 'unknown').toLowerCase(),
            deviceState: (result.device_state || 'idle').toLowerCase(),
            app: result.app || '',
            appId: result.app_id || '',
            position: result.position || 0,
            duration: result.total_time || 0,
            shuffle: (result.shuffle || 'off').toLowerCase(),
            repeat: (result.repeat || 'off').toLowerCase(),
        };
    }

    async sendCommand(command) {
        const pyatvCmd = PYATV_COMMAND_MAP[command] || command;
        const args = [...this._buildDeviceArgs(), pyatvCmd];
        await this._execAtvscript(args);
    }

    async getPowerState() {
        const args = [...this._buildDeviceArgs(), 'power_state'];
        const result = await this._execAtvscript(args);
        return result.power_state === 'on';
    }

    async turnOn() {
        const args = [...this._buildDeviceArgs(), 'turn_on'];
        await this._execAtvscript(args);
    }

    async turnOff() {
        const args = [...this._buildDeviceArgs(), 'turn_off'];
        await this._execAtvscript(args);
    }

    async seekTo(positionSeconds) {
        const args = [...this._buildDeviceArgs(), 'set_position=' + Math.floor(positionSeconds)];
        await this._execAtvscript(args);
    }

    async getAppList() {
        try {
            const args = [...this._buildDeviceArgs(), 'app_list'];
            const result = await this._execAtvscript(args);
            return (result.apps || []).map(a => ({
                name: a.name || '',
                id: a.identifier || '',
            }));
        } catch (err) {
            this.log.warn('Failed to get app list (companion credentials may be needed): ' + err.message);
            return [];
        }
    }

    async launchApp(appId) {
        const args = [...this._buildDeviceArgs(), 'launch_app=' + appId];
        await this._execAtvscript(args);
    }

    async getArtwork(width, height) {
        width = width || 300;
        height = height || -1;
        const tmpPath = path.join(os.tmpdir(), 'atv_artwork_' + Date.now() + '.png');
        try {
            const args = [
                ...this._buildDeviceArgs(),
                'artwork_save=' + tmpPath,
            ];
            await this._execAtvremote(args);
            const data = await fs.promises.readFile(tmpPath);
            await fs.promises.unlink(tmpPath).catch(() => {});
            return { data, mimetype: 'image/png' };
        } catch (err) {
            this.log.debug('Failed to fetch artwork: ' + err.message);
            await fs.promises.unlink(tmpPath).catch(() => {});
            return null;
        }
    }

    startPushUpdates(onUpdate) {
        const args = [...this._buildDeviceArgs(), 'push_updates'];
        const proc = spawn(this.atvscriptPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let buffer = '';

        proc.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    if (event.result !== 'success') {
                        this.log.warn('Push update error: ' + JSON.stringify(event));
                        continue;
                    }
                    this._processPushEvent(event, onUpdate);
                } catch (parseErr) {
                    this.log.debug('Failed to parse push update line: ' + line);
                }
            }
        });

        proc.stderr.on('data', (chunk) => {
            this.log.debug('atvscript push_updates stderr: ' + chunk.toString());
        });

        proc.on('error', (err) => {
            this.log.error('Push updates process error: ' + err.message);
            onUpdate({ type: 'connection', data: { connected: false, reason: 'process_error' } });
        });

        proc.on('exit', (code) => {
            this.log.info('Push updates process exited with code ' + code);
            onUpdate({ type: 'connection', data: { connected: false, reason: 'process_exit' } });
        });

        return {
            stop: () => {
                try {
                    proc.stdin.write('\n');
                    setTimeout(() => {
                        if (!proc.killed) proc.kill('SIGTERM');
                    }, 2000);
                } catch (_err) {
                    // Process may already be dead
                }
            },
            process: proc,
        };
    }

    _processPushEvent(event, onUpdate) {
        if ('power_state' in event) {
            onUpdate({
                type: 'power',
                data: { state: event.power_state === 'on' },
            });
        }

        if ('title' in event || 'device_state' in event) {
            onUpdate({
                type: 'playing',
                data: {
                    title: event.title || '',
                    artist: event.artist || '',
                    album: event.album || '',
                    genre: event.genre || '',
                    mediaType: (event.media_type || 'unknown').toLowerCase(),
                    deviceState: (event.device_state || 'idle').toLowerCase(),
                    app: event.app || '',
                    appId: event.app_id || '',
                    position: event.position || 0,
                    duration: event.total_time || 0,
                    shuffle: (event.shuffle || 'off').toLowerCase(),
                    repeat: (event.repeat || 'off').toLowerCase(),
                },
            });
        }

        if ('volume' in event) {
            onUpdate({
                type: 'volume',
                data: { level: event.volume },
            });
        }

        if ('connection' in event) {
            onUpdate({
                type: 'connection',
                data: { connected: false, reason: event.connection },
            });
        }
    }

    async isReachable() {
        try {
            await this.getPowerState();
            return true;
        } catch (_err) {
            return false;
        }
    }
}

module.exports = { PyatvBackend };
