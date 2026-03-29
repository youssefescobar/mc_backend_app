/**
 * translationService.js
 * ---------------------
 * Wraps the Google Cloud Translation API v2 (Basic).
 * Uses an API key from GOOGLE_TRANSLATE_API_KEY env var.
 *
 * Features:
 *  - Auto-detects source language (no need to specify it)
 *  - In-memory cache capped at 1 000 entries to avoid repeated API calls
 *    for common phrases (e.g. "Reminder", "New Message")
 *  - Graceful fallback: returns original text on error, never throws
 */

const https = require('https');
const { logger } = require('../config/logger');

// ─── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_MAX = 1000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Translate a single string to the target language.
 *
 * @param {string} text        - The text to translate.
 * @param {string} targetLang  - BCP-47 code matching user.language field
 *                               ('en', 'ar', 'ur', 'fr', 'id', 'tr').
 * @returns {Promise<string>}  - Translated text, or original on error.
 */
async function translateText(text, targetLang) {
    if (!text) return '';

    const lang = (targetLang || 'en').toLowerCase();
    const cacheKey = `${lang}:${text}`;

    if (_cache.has(cacheKey)) {
        logger.debug(`[Translation] Cache hit → lang="${lang}" "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`);
        return _cache.get(cacheKey);
    }

    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
        logger.warn('[Translation] GOOGLE_TRANSLATE_API_KEY not set — returning original text');
        return text;
    }

    const preview = `"${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`;
    logger.info(`[Translation] API call → lang="${lang}" text=${preview}`);

    try {
        const translated = await _callApi(text, lang, apiKey);

        logger.info(`[Translation] ✓ lang="${lang}" ${preview} → "${translated.substring(0, 50)}${translated.length > 50 ? '...' : ''}"`);

        // Evict oldest entry if at capacity (Map preserves insertion order)
        if (_cache.size >= CACHE_MAX) {
            _cache.delete(_cache.keys().next().value);
        }
        _cache.set(cacheKey, translated);
        return translated;
    } catch (err) {
        logger.warn(`[Translation] ✗ Failed translating to "${lang}": ${err.message} — returning original`);
        return text; // Graceful fallback — never break the notification flow
    }
}

/**
 * Translate text to multiple languages in parallel.
 *
 * @param {string}   text            - Source text.
 * @param {string[]} targetLanguages - Array of BCP-47 codes.
 * @returns {Promise<Object.<string, string>>} Map of { lang -> translatedText }.
 */
async function translateToLanguages(text, targetLanguages) {
    const pairs = await Promise.all(
        targetLanguages.map(async (lang) => [lang, await translateText(text, lang)])
    );
    return Object.fromEntries(pairs);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _callApi(text, targetLang, apiKey) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ q: text, target: targetLang, format: 'text' });

        const options = {
            hostname: 'translation.googleapis.com',
            path: `/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.data?.translations?.[0]?.translatedText) {
                        resolve(json.data.translations[0].translatedText);
                    } else {
                        reject(new Error(json.error?.message || `HTTP ${res.statusCode}: unexpected response`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { translateText, translateToLanguages };
