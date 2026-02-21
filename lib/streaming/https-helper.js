'use strict';

const https = require('https');

/**
 * Simple Promise wrapper around Node.js https.request.
 * No external dependencies needed.
 *
 * @param {object} options - https.request options (host, path, method, headers, ...)
 * @param {string} [postData] - Request body (for POST requests)
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
function httpsRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body,
                });
            });
        });

        req.on('error', (err) => {
            reject(new Error('HTTPS request failed: ' + err.message));
        });

        req.setTimeout(15000, () => {
            req.destroy(new Error('HTTPS request timeout (15s)'));
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

/**
 * Parse JSON response body, throw on error status codes.
 */
function parseJsonResponse(response, context) {
    if (response.statusCode >= 400) {
        throw new Error(context + ' HTTP ' + response.statusCode + ': ' + response.body.substring(0, 200));
    }
    try {
        return JSON.parse(response.body);
    } catch (err) {
        throw new Error(context + ' JSON parse error: ' + err.message);
    }
}

/**
 * Extract Set-Cookie headers into a simple cookie string for subsequent requests.
 */
function extractCookies(response) {
    const setCookies = response.headers['set-cookie'];
    if (!setCookies) return '';
    return setCookies.map(c => c.split(';')[0]).join('; ');
}

module.exports = { httpsRequest, parseJsonResponse, extractCookies };
