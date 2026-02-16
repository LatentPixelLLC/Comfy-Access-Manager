/**
 * Digital Media Vault - Copyright (c) 2026 Greg Tee. All Rights Reserved.
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

    try {
        const raw = getSetting('path_mappings');
        if (!raw) return filePath;

        const mappings = JSON.parse(raw);
        if (!Array.isArray(mappings) || mappings.length === 0) return filePath;

        // Normalize separators for comparison
        const normalized = filePath.replace(/\\/g, '/');

        for (const mapping of mappings) {
            const from = (mapping.from || '').replace(/\\/g, '/').replace(/\/+$/, '');
            const to = (mapping.to || '').replace(/\\/g, '/').replace(/\/+$/, '');
            if (!from || !to) continue;

            // Check if the path starts with either side of the mapping
            if (normalized.toLowerCase().startsWith(from.toLowerCase() + '/') ||
                normalized.toLowerCase() === from.toLowerCase()) {
                const remainder = normalized.substring(from.length);
                const resolved = to + remainder;
                // Convert to OS-native separators
                return process.platform === 'win32'
                    ? resolved.replace(/\//g, '\\')
                    : resolved;
            }

            if (normalized.toLowerCase().startsWith(to.toLowerCase() + '/') ||
                normalized.toLowerCase() === to.toLowerCase()) {
                const remainder = normalized.substring(to.length);
                const resolved = from + remainder;
                return process.platform === 'win32'
                    ? resolved.replace(/\//g, '\\')
                    : resolved;
            }
        }
    } catch (e) {
        // If mappings can't be parsed, just return original path
    }

    return filePath;
}

module.exports = { resolveFilePath };
