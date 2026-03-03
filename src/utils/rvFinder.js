/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * RV Finder — Shared utility for locating OpenRV binaries.
 * Used by assetRoutes, reviewRoutes, and RVPluginSync.
 *
 * Search priority:
 *   1. User-configured rv_path setting
 *   2. Bundled: tools/rv/ (installed by install.bat / install.sh)
 *   3. Self-compiled OpenRV builds (~/OpenRV or C:\OpenRV)
 *   4. System installs (/Applications, C:\Program Files, /opt)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const { getSetting } = require('../database');
const { resolveFilePath } = require('./pathResolver');

let _cachedRvPath;

/**
 * Find the RV executable.
 * Checks standard install locations per platform.
 * @returns {string|null} - Absolute path to the RV binary, or null
 */
function findRV() {
    if (_cachedRvPath !== undefined) return _cachedRvPath;

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    // 1. Check user-configured RV path in settings (highest priority)
    try {
        const customPath = getSetting('rv_path');
        if (customPath && fs.existsSync(customPath)) {
            _cachedRvPath = customPath;
            return _cachedRvPath;
        }
    } catch (e) { /* settings not ready yet */ }

    // 2. Check MediaVault bundled RV (tools/rv/ — installed by install.bat / install.sh)
    if (isMac) {
        const bundledRvMac = path.join(__dirname, '..', '..', 'tools', 'rv', 'RV.app', 'Contents', 'MacOS', 'RV');
        if (fs.existsSync(bundledRvMac)) { _cachedRvPath = bundledRvMac; return _cachedRvPath; }
    }
    const bundledRv = path.join(__dirname, '..', '..', 'tools', 'rv', 'bin', isWin ? 'rv.exe' : 'rv');
    if (fs.existsSync(bundledRv)) { _cachedRvPath = bundledRv; return _cachedRvPath; }

    // 3. Check OpenRV local build (common for self-compiled OpenRV)
    if (isWin) {
        const openrvBuild = 'C:\\OpenRV\\_build\\stage\\app\\bin\\rv.exe';
        if (fs.existsSync(openrvBuild)) { _cachedRvPath = openrvBuild; return _cachedRvPath; }
    } else if (isMac) {
        const homedir = os.homedir();
        const macBuilds = [
            path.join(homedir, 'OpenRV', '_build', 'stage', 'app', 'RV.app', 'Contents', 'MacOS', 'RV'),
            path.join(homedir, 'OpenRV', '_install', 'RV.app', 'Contents', 'MacOS', 'RV'),
        ];
        for (const p of macBuilds) {
            if (fs.existsSync(p)) { _cachedRvPath = p; return _cachedRvPath; }
        }
    }

    // 4. System installs
    if (isWin) {
        const searchDirs = ['C:\\Program Files', 'C:\\Program Files (x86)'];
        const folderPrefixes = ['Autodesk\\RV', 'Shotgun\\RV', 'ShotGrid\\RV', 'Shotgun RV', 'RV'];
        for (const base of searchDirs) {
            for (const prefix of folderPrefixes) {
                const exe = path.join(base, prefix, 'bin', 'rv.exe');
                if (fs.existsSync(exe)) { _cachedRvPath = exe; return _cachedRvPath; }
            }
            // Scan for versioned folders like "Autodesk/RV-2024.0.1"
            try {
                const autodesk = path.join(base, 'Autodesk');
                if (fs.existsSync(autodesk)) {
                    for (const d of fs.readdirSync(autodesk).filter(d => d.startsWith('RV'))) {
                        const exe = path.join(autodesk, d, 'bin', 'rv.exe');
                        if (fs.existsSync(exe)) { _cachedRvPath = exe; return _cachedRvPath; }
                    }
                }
            } catch (e) { /* ignore scan errors */ }
            try {
                const shotgun = path.join(base, 'Shotgun');
                if (fs.existsSync(shotgun)) {
                    for (const d of fs.readdirSync(shotgun).filter(d => d.startsWith('RV'))) {
                        const exe = path.join(shotgun, d, 'bin', 'rv.exe');
                        if (fs.existsSync(exe)) { _cachedRvPath = exe; return _cachedRvPath; }
                    }
                }
            } catch (e) { /* ignore scan errors */ }
        }
    } else if (isMac) {
        const candidates = [
            '/Applications/RV.app/Contents/MacOS/RV',
            '/Applications/Autodesk/RV.app/Contents/MacOS/RV',
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) { _cachedRvPath = c; return _cachedRvPath; }
        }
        try {
            for (const d of fs.readdirSync('/Applications').filter(d => d.startsWith('RV') && d.endsWith('.app'))) {
                const exe = path.join('/Applications', d, 'Contents', 'MacOS', 'RV');
                if (fs.existsSync(exe)) { _cachedRvPath = exe; return _cachedRvPath; }
            }
        } catch (e) { /* ignore */ }
    } else {
        // Linux
        const candidates = [
            '/usr/local/rv/bin/rv',
            '/opt/rv/bin/rv',
            '/usr/local/bin/rv',
            '/usr/bin/rv',
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) { _cachedRvPath = c; return _cachedRvPath; }
        }
        try {
            for (const d of fs.readdirSync('/opt').filter(d => d.startsWith('rv'))) {
                const exe = path.join('/opt', d, 'bin', 'rv');
                if (fs.existsSync(exe)) { _cachedRvPath = exe; return _cachedRvPath; }
            }
        } catch (e) { /* ignore */ }
    }

    _cachedRvPath = null;
    return null;
}

/**
 * Find rvpush companion tool (lives next to rv in same bin/ dir).
 * rvpush sends commands to a running RV session over network.
 * @returns {string|null}
 */
function findRvPush() {
    const rvExe = findRV();
    if (!rvExe) return null;
    const rvDir = path.dirname(rvExe);
    const pushExe = path.join(rvDir, process.platform === 'win32' ? 'rvpush.exe' : 'rvpush');
    if (fs.existsSync(pushExe)) return pushExe;
    return null;
}

/**
 * Check if an RV process is currently running.
 * @returns {boolean}
 */
function isRvRunning() {
    try {
        if (process.platform === 'win32') {
            const out = execSync('tasklist /FI "IMAGENAME eq rv.exe" /NH', { windowsHide: true, encoding: 'utf8' });
            return out.includes('rv.exe');
        } else {
            execSync('pgrep -x rv', { stdio: 'ignore' });
            return true;
        }
    } catch { return false; }
}

/**
 * Try to push files to a running RV session via rvpush.
 * @param {string} pushExe - Path to rvpush executable
 * @param {string[]} filePaths - Files to load
 * @param {string} mode - 'set' (replace) or 'merge' (add)
 * @returns {{ success: boolean, started: boolean }}
 */
function rvPush(pushExe, filePaths, mode = 'set') {
    const cwd = path.dirname(pushExe);
    const args = [mode, ...filePaths];
    const env = { ...process.env, RVPUSH_RV_EXECUTABLE_PATH: 'none' };

    const result = spawnSync(pushExe, args, { cwd, windowsHide: true, timeout: 5000, encoding: 'utf8', env });

    if (result.status === 0) {
        console.log(`[RV] rvpush ${mode}: ${filePaths.length} file(s) → running session`);
        return { success: true, started: false };
    }
    if (result.status === 15) {
        console.log(`[RV] rvpush ${mode}: started new RV with ${filePaths.length} file(s)`);
        return { success: true, started: true };
    }
    return { success: false, started: false };
}

/**
 * Resolve an asset DB row to the path RV should receive.
 * For regular files: returns the resolved file path.
 * For image sequences: returns RV sequence notation, e.g.
 *   /path/to/render.1001-1100#.exr  (one # per padding digit)
 * @param {Object} asset - Asset row with file_path, is_sequence, frame_pattern, frame_start, frame_end
 * @returns {string|null} RV-compatible path, or null if file doesn't exist
 */
function resolveAssetRvPath(asset) {
    if (!asset || !asset.file_path) return null;

    const resolved = resolveFilePath(asset.file_path);

    if (asset.is_sequence && asset.frame_pattern && asset.frame_start != null && asset.frame_end != null) {
        const dir = path.dirname(resolved);
        const pattern = asset.frame_pattern;
        const padMatch = pattern.match(/%0(\d+)d/);
        const digits = padMatch ? parseInt(padMatch[1], 10) : 4;
        const hashes = '#'.repeat(digits);
        const rvPattern = pattern.replace(/%0\d+d/, `${asset.frame_start}-${asset.frame_end}${hashes}`);
        const rvPath = path.join(dir, rvPattern);

        // Verify at least the first frame exists
        const firstFrame = pattern.replace(/%0\d+d/, String(asset.frame_start).padStart(digits, '0'));
        const firstFramePath = path.join(dir, firstFrame);
        if (fs.existsSync(firstFramePath)) return rvPath;

        // Fallback: try resolved file_path directly
        if (fs.existsSync(resolved)) return resolved;
        return null;
    }

    // Regular file
    if (fs.existsSync(resolved)) return resolved;
    return null;
}

/**
 * Clear the cached RV path (e.g., if the user changes rv_path in settings).
 */
function clearCache() {
    _cachedRvPath = undefined;
}

module.exports = { findRV, findRvPush, isRvRunning, rvPush, resolveAssetRvPath, clearCache };
