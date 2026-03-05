/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * OpenImageIO (oiiotool) utilities — Binary locator for DWAB EXR compression.
 *
 * oiiotool is part of OpenImageIO (ASWF, Apache 2.0 license).
 * It supports all EXR compression modes including DWAB — which FFmpeg's EXR
 * encoder lacks (FFmpeg only supports none/rle/zip1/zip16).
 *
 * Used by proxyRoutes.js for full-resolution DWAB proxy generation.
 *
 * Installation:
 *   All platforms: pip install OpenImageIO  (official PyPI wheel, includes oiiotool)
 *   macOS alt:     brew install openimageio
 *   Linux alt:     apt install openimageio-tools
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Cache
let _cachedOiiotoolPath;

/**
 * Find oiiotool on PATH or in well-known locations.
 * Checks: PATH → tools/oiio/ → common VFX app locations → system paths.
 * Result is cached after first successful lookup.
 *
 * @returns {string|null} Path to oiiotool binary, or null if not found.
 */
function findOiiotool() {
    if (_cachedOiiotoolPath !== undefined) return _cachedOiiotoolPath;

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const exeName = isWin ? 'oiiotool.exe' : 'oiiotool';

    // Local bundled path (installed by install.bat / install.sh)
    const localTools = path.join(__dirname, '..', '..', 'tools', 'oiio', 'bin', exeName);

    const candidates = [
        exeName,        // Works if on PATH (brew/apt/pip installs put it on PATH)
        localTools,     // Local tools/ directory
        ...(isWin ? [
            // Python Scripts directory (pip install OpenImageIO puts oiiotool here)
            ...getPythonScriptsPaths(exeName),
            // Common Windows locations
            path.join(process.env.LOCALAPPDATA || '', 'oiio', 'bin', exeName),
            'C:\\oiio\\bin\\oiiotool.exe',
            'C:\\Program Files\\oiio\\bin\\oiiotool.exe',
            // Houdini ships with oiiotool
            ...getHoudiniPaths(exeName),
        ] : isMac ? [
            '/opt/homebrew/bin/oiiotool',       // macOS Apple Silicon (Homebrew)
            '/usr/local/bin/oiiotool',          // macOS Intel (Homebrew)
        ] : [
            '/usr/bin/oiiotool',                // Linux system package
            '/usr/local/bin/oiiotool',          // Linux manual install
        ]),
    ];

    for (const candidate of candidates) {
        try {
            if (candidate === exeName) {
                // Test if it's on PATH by running --version
                execFileSync(exeName, ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
                _cachedOiiotoolPath = exeName;
                console.log(`[OIIO] Found oiiotool on PATH`);
                return _cachedOiiotoolPath;
            } else if (fs.existsSync(candidate)) {
                _cachedOiiotoolPath = candidate;
                console.log(`[OIIO] Found oiiotool at: ${candidate}`);
                return _cachedOiiotoolPath;
            }
        } catch { /* not found at this candidate */ }
    }

    _cachedOiiotoolPath = null;
    return null;
}

/**
 * Get Python Scripts directories where pip installs executables.
 * `pip install OpenImageIO` puts oiiotool.exe in Scripts/.
 */
function getPythonScriptsPaths(exeName) {
    const paths = [];
    try {
        // Try multiple common Python locations on Windows
        const pyBases = [
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : null,
            'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
        ].filter(Boolean);
        for (const base of pyBases) {
            if (!fs.existsSync(base)) continue;
            // Direct Python install: C:\PythonXXX\Scripts\
            const directScripts = path.join(base, 'Scripts', exeName);
            if (fs.existsSync(path.dirname(directScripts))) paths.push(directScripts);
            // AppData nested: C:\...\Python\PythonXXX\Scripts\
            try {
                const subdirs = fs.readdirSync(base).filter(d => d.startsWith('Python'));
                subdirs.sort().reverse();
                for (const d of subdirs) {
                    paths.push(path.join(base, d, 'Scripts', exeName));
                }
            } catch { /* ignore */ }
        }
        // Also check the user PATH environment for "Scripts" dirs
        const userPath = process.env.PATH || '';
        const scriptDirs = userPath.split(';').filter(p => p.toLowerCase().includes('scripts'));
        for (const d of scriptDirs) {
            paths.push(path.join(d, exeName));
        }
    } catch { /* ignore */ }
    return paths;
}

/**
 * Get Houdini install paths that may contain oiiotool.
 * Houdini bundles OpenImageIO tools.
 */
function getHoudiniPaths(exeName) {
    const paths = [];
    const houBase = 'C:\\Program Files\\Side Effects Software';
    try {
        if (fs.existsSync(houBase)) {
            const dirs = fs.readdirSync(houBase).filter(d => d.startsWith('Houdini'));
            // Sort newest first
            dirs.sort().reverse();
            for (const d of dirs) {
                paths.push(path.join(houBase, d, 'bin', exeName));
            }
        }
    } catch { /* ignore */ }
    return paths;
}

/**
 * Check if oiiotool is available (returns true/false without the path).
 * Does not trigger a full search if already cached.
 */
function isOiiotoolAvailable() {
    return findOiiotool() !== null;
}

/**
 * Clear the cached path (e.g., after install or settings change).
 */
function clearCache() {
    _cachedOiiotoolPath = undefined;
}

module.exports = { findOiiotool, isOiiotoolAvailable, clearCache };
