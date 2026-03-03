/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * MediaVault - Cross-Platform Path Resolver
 * Translates file paths using path mappings so assets imported on one OS
 * (e.g., Windows Z:\Media\...) resolve on another (e.g., Mac /Volumes/media/...).
 */

const { getSetting } = require('../database');

/**
 * Load and normalize path mappings from settings.
 * Returns an array of { sides: string[] } where sides are forward-slash normalized
 * path prefixes from each platform.
 * @returns {{ sides: string[] }[]}
 */
function _loadMappings() {
    try {
        const raw = getSetting('path_mappings');
        if (!raw) return [];
        const mappings = JSON.parse(raw);
        if (!Array.isArray(mappings) || mappings.length === 0) return [];

        return mappings.map(mapping => {
            let sides;
            if (mapping.from && mapping.to) {
                sides = [mapping.from, mapping.to];
            } else {
                const w = mapping.windows || mapping.win || '';
                const m = mapping.mac || mapping.macos || '';
                const l = mapping.linux || '';
                sides = [w, m, l].filter(Boolean);
            }
            return {
                sides: sides.map(s => s.replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean),
                raw: mapping,
            };
        }).filter(m => m.sides.length >= 2);
    } catch {
        return [];
    }
}

/**
 * Apply path mappings to translate a file path for the current platform.
 * Mappings are pairs like { from: "Z:\\Media", to: "/Volumes/media" }.
 * On Mac, Z:\Media\Project\file.mov → /Volumes/media/Project/file.mov
 * On PC, /Volumes/media/Project/file.mov → Z:\Media\Project\file.mov
 *
 * @param {string} filePath - The stored file path (may be from another OS)
 * @returns {string} - The resolved path for the current platform
 */
function resolveFilePath(filePath) {
    if (!filePath) return filePath;

    const mappings = _loadMappings();
    if (mappings.length === 0) return filePath;

    const normalized = filePath.replace(/\\/g, '/');
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    for (const { sides, raw } of mappings) {
        for (let i = 0; i < sides.length; i++) {
            const src = sides[i];

            if (normalized.toLowerCase().startsWith(src.toLowerCase() + '/') ||
                normalized.toLowerCase() === src.toLowerCase()) {
                // Find the best target for the current platform
                let target = null;
                if (raw.from && raw.to) {
                    target = (i === 0) ? raw.to : raw.from;
                } else {
                    if (isMac) target = raw.mac || raw.macos;
                    else if (isWin) target = raw.windows || raw.win;
                    else target = raw.linux || raw.mac || raw.macos;
                }
                if (!target) continue;
                const targetClean = target.replace(/\\/g, '/').replace(/\/+$/, '');
                if (targetClean.toLowerCase() === src.toLowerCase()) continue;
                const remainder = normalized.substring(src.length);
                const resolved = targetClean + remainder;
                return process.platform === 'win32'
                    ? resolved.replace(/\//g, '\\')
                    : resolved;
            }
        }
    }

    return filePath;
}

/**
 * Return all possible path representations for a file path.
 * Given a Mac path, also returns the Windows/Linux equivalents (and vice versa)
 * by applying every configured mapping in both directions.
 * Used for DB lookups where the stored platform may differ from the current one.
 *
 * @param {string} filePath - Any platform's file path
 * @returns {string[]} - Array of normalized (forward-slash) path variants
 */
function getAllPathVariants(filePath) {
    if (!filePath) return [];
    const variants = new Set();
    const normalized = filePath.replace(/\\/g, '/');
    variants.add(normalized);

    const mappings = _loadMappings();
    for (const { sides } of mappings) {
        for (let i = 0; i < sides.length; i++) {
            const src = sides[i];

            if (normalized.toLowerCase().startsWith(src.toLowerCase() + '/') ||
                normalized.toLowerCase() === src.toLowerCase()) {
                const remainder = normalized.substring(src.length);
                for (let j = 0; j < sides.length; j++) {
                    if (j === i) continue;
                    if (sides[j]) variants.add(sides[j] + remainder);
                }
            }
        }
    }

    // Also include backslash versions of every variant so that DB
    // lookups match paths stored with Windows separators (Z:\... vs Z:/...)
    const withBackslashes = [];
    for (const v of variants) {
        const bs = v.replace(/\//g, '\\');
        if (!variants.has(bs)) withBackslashes.push(bs);
    }
    for (const bs of withBackslashes) variants.add(bs);

    return [...variants];
}

module.exports = { resolveFilePath, getAllPathVariants };
