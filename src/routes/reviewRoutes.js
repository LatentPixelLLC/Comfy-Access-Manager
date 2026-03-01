/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * reviewRoutes — API for RV Sync Review Sessions
 *
 * Enables multi-user synchronized review via RV's built-in network sync.
 * One user "hosts" a review session (RV with -networkPort), and others
 * "join" (RV with -networkConnect). CAM orchestrates the discovery and
 * connection so users don't need to exchange IPs/ports manually.
 *
 * Flow:
 *   1. User clicks "Start Sync Review" on asset(s)
 *   2. CAM launches RV with `-networkPort <port>` locally
 *   3. Session is registered on hub DB, SSE broadcast to all spokes
 *   4. Other users see "Active Review" notification, click "Join"
 *   5. CAM launches their local RV with `-networkConnect <hostIp> <port>`
 *   6. When host closes session, hub DB updated, SSE broadcast sent
 *
 * RV handles all playback sync, annotations, scrubbing, etc. natively.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { getDb, getSetting, logActivity } = require('../database');
const { resolveFilePath } = require('../utils/pathResolver');

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/**
 * Get this machine's LAN IP address (for RV network sync).
 * Prefers en0/eth0 IPv4 addresses; falls back to first non-internal IPv4.
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    // Prefer common interface names
    for (const name of ['en0', 'eth0', 'en1', 'Ethernet', 'Wi-Fi']) {
        const iface = interfaces[name];
        if (iface) {
            const v4 = iface.find(a => a.family === 'IPv4' && !a.internal);
            if (v4) return v4.address;
        }
    }
    // Fallback: first non-internal IPv4
    for (const iface of Object.values(interfaces)) {
        const v4 = iface.find(a => a.family === 'IPv4' && !a.internal);
        if (v4) return v4.address;
    }
    return '127.0.0.1';
}

/**
 * Find the RV executable (reuse logic from assetRoutes).
 * We import lazily to avoid circular dependency issues.
 */
function findRV() {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    // 1. User-configured path
    try {
        const customPath = getSetting('rv_path');
        if (customPath && fs.existsSync(customPath)) return customPath;
    } catch (e) { /* settings not ready */ }

    // 2. Bundled RV
    if (isMac) {
        const bundledMac = path.join(__dirname, '..', '..', 'tools', 'rv', 'RV.app', 'Contents', 'MacOS', 'RV');
        if (fs.existsSync(bundledMac)) return bundledMac;
    }
    const bundled = path.join(__dirname, '..', '..', 'tools', 'rv', 'bin', isWin ? 'rv.exe' : 'rv');
    if (fs.existsSync(bundled)) return bundled;

    // 3. Standard locations
    if (isWin) {
        const searchDirs = ['C:\\Program Files', 'C:\\Program Files (x86)'];
        const prefixes = ['Autodesk\\RV', 'Shotgun\\RV', 'ShotGrid\\RV', 'Shotgun RV', 'RV'];
        for (const base of searchDirs) {
            for (const prefix of prefixes) {
                const exe = path.join(base, prefix, 'bin', 'rv.exe');
                if (fs.existsSync(exe)) return exe;
            }
            try {
                const autodesk = path.join(base, 'Autodesk');
                if (fs.existsSync(autodesk)) {
                    for (const d of fs.readdirSync(autodesk).filter(d => d.startsWith('RV'))) {
                        const exe = path.join(autodesk, d, 'bin', 'rv.exe');
                        if (fs.existsSync(exe)) return exe;
                    }
                }
            } catch (e) { /* ignore */ }
        }
        // OpenRV local build
        const openrvBuild = 'C:\\OpenRV\\_build\\stage\\app\\bin\\rv.exe';
        if (fs.existsSync(openrvBuild)) return openrvBuild;
    } else if (isMac) {
        const candidates = [
            '/Applications/RV.app/Contents/MacOS/RV',
            '/Applications/Autodesk/RV.app/Contents/MacOS/RV',
        ];
        for (const c of candidates) { if (fs.existsSync(c)) return c; }
        try {
            for (const d of fs.readdirSync('/Applications').filter(d => d.startsWith('RV') && d.endsWith('.app'))) {
                const exe = path.join('/Applications', d, 'Contents', 'MacOS', 'RV');
                if (fs.existsSync(exe)) return exe;
            }
        } catch (e) { /* ignore */ }
        const homedir = os.homedir();
        const macBuilds = [
            path.join(homedir, 'OpenRV', '_build', 'stage', 'app', 'RV.app', 'Contents', 'MacOS', 'RV'),
            path.join(homedir, 'OpenRV', '_install', 'RV.app', 'Contents', 'MacOS', 'RV'),
        ];
        for (const p of macBuilds) { if (fs.existsSync(p)) return p; }
    } else {
        const candidates = ['/usr/local/rv/bin/rv', '/opt/rv/bin/rv', '/usr/local/bin/rv', '/usr/bin/rv'];
        for (const c of candidates) { if (fs.existsSync(c)) return c; }
    }
    return null;
}

/**
 * Resolve asset IDs to file paths for RV.
 */
function resolveAssetPaths(assetIds) {
    const db = getDb();
    const filePaths = [];
    // Ensure assetIds is always an array (guard against JSON parse returning a scalar)
    const ids = Array.isArray(assetIds) ? assetIds : (assetIds ? [assetIds] : []);
    for (const id of ids) {
        const asset = db.prepare(
            'SELECT file_path, is_sequence, frame_pattern, frame_start, frame_end FROM assets WHERE id = ?'
        ).get(id);
        if (!asset || !asset.file_path) continue;

        const resolved = resolveFilePath(asset.file_path);
        if (!resolved) continue;

        if (asset.is_sequence && asset.frame_pattern && asset.frame_start != null && asset.frame_end != null) {
            // Build RV sequence notation: /path/render.1001-1100####.exr
            const dir = path.dirname(resolved);
            const padMatch = asset.frame_pattern.match(/%0(\d+)d/);
            const digits = padMatch ? parseInt(padMatch[1], 10) : 4;
            const hashes = '#'.repeat(digits);
            const rvPattern = asset.frame_pattern.replace(/%0\d+d/, `${asset.frame_start}-${asset.frame_end}${hashes}`);
            filePaths.push(path.join(dir, rvPattern));
        } else {
            if (fs.existsSync(resolved)) filePaths.push(resolved);
        }
    }
    return filePaths;
}


// ═══════════════════════════════════════════
//  GET /api/review/sessions — List active review sessions
// ═══════════════════════════════════════════
router.get('/sessions', (req, res) => {
    const db = getDb();
    const sessions = db.prepare(
        `SELECT * FROM review_sessions WHERE status = 'active' ORDER BY started_at DESC`
    ).all();

    // Parse asset_ids JSON (guard against scalars from malformed DB entries)
    for (const s of sessions) {
        try {
            const parsed = JSON.parse(s.asset_ids || '[]');
            s.asset_ids = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        } catch { s.asset_ids = []; }
    }

    res.json({ sessions });
});

// ═══════════════════════════════════════════
//  GET /api/review/sessions/:id — Get a single session
// ═══════════════════════════════════════════
router.get('/sessions/:id', (req, res) => {
    const db = getDb();
    const session = db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    try { session.asset_ids = JSON.parse(session.asset_ids || '[]'); } catch { session.asset_ids = []; }

    // Include asset details for display
    if (session.asset_ids.length > 0) {
        const placeholders = session.asset_ids.map(() => '?').join(',');
        session.assets = db.prepare(
            `SELECT id, vault_name, file_path, media_type, thumbnail_path FROM assets WHERE id IN (${placeholders})`
        ).all(...session.asset_ids);
    } else {
        session.assets = [];
    }

    res.json(session);
});


// ═══════════════════════════════════════════
//  POST /api/review/start — Start a sync review (host side)
//  Body: { assetIds: [1,2,...], title?: string, port?: number }
//
//  This endpoint:
//    1. Launches RV locally with -networkPort <port>
//    2. Registers the session in the DB
//    3. Broadcasts SSE event so other users see it
// ═══════════════════════════════════════════
router.post('/start', (req, res) => {
    const { assetIds, title, port } = req.body || {};

    if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
        return res.status(400).json({ error: 'Provide an array of assetIds' });
    }

    const rvExe = findRV();
    if (!rvExe) {
        return res.status(404).json({ error: 'RV not found on this machine' });
    }

    const networkPort = port || 45128;
    const hostIp = getLocalIP();
    const sessionKey = crypto.randomUUID();
    const hostName = os.hostname();
    const db = getDb();

    // Resolve asset file paths for RV
    const filePaths = resolveAssetPaths(assetIds);
    if (filePaths.length === 0) {
        return res.status(400).json({ error: 'No resolvable files found for the given assets' });
    }

    // Get user info
    const userName = req.headers['x-cam-user'] || 'Unknown';

    // Launch RV with network sync enabled (as host)
    try {
        launchRVAsHost(rvExe, filePaths, networkPort);
    } catch (err) {
        return res.status(500).json({ error: `Failed to launch RV: ${err.message}` });
    }

    // Register session in DB
    const sessionTitle = title || `Review by ${userName}`;
    const result = db.prepare(`
        INSERT INTO review_sessions (session_key, host_name, host_ip, host_port, status, asset_ids, title, started_by)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(sessionKey, hostName, hostIp, networkPort, JSON.stringify(assetIds), sessionTitle, userName);

    const sessionId = Number(result.lastInsertRowid);

    logActivity('review_start', 'review_session', sessionId,
        `Sync review started: ${sessionTitle} (${assetIds.length} assets)`);

    // Broadcast to spokes via SSE (hub mode)
    // Keep asset_ids as a JSON string so spoke's _applyChange stores it correctly in SQLite
    const session = db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(sessionId);

    req.app.locals.broadcastChange?.('review_sessions', 'insert', { record: session });

    // In spoke mode, also register the session on the hub DB so other spokes can see it
    const spokeService = req.app.locals.spokeService;
    if (spokeService) {
        spokeService.forwardRequest('POST', '/api/sync/write', {
            method: 'POST',
            path: '/api/review/hub-register',
            body: {
                session_key: sessionKey,
                host_name: hostName,
                host_ip: hostIp,
                host_port: networkPort,
                asset_ids: assetIds,
                title: sessionTitle,
                started_by: userName,
            },
            spokeName: spokeService.localName,
        }).then(() => {
            console.log(`[SyncReview] Session registered on hub: ${sessionTitle}`);
        }).catch(err => {
            console.error(`[SyncReview] Failed to register session on hub:`, err.message);
        });
    }

    res.json({
        success: true,
        session: {
            id: sessionId,
            sessionKey,
            hostIp,
            hostPort: networkPort,
            title: sessionTitle,
            assetCount: filePaths.length,
        }
    });
});


// ═══════════════════════════════════════════
//  POST /api/review/join — Join an existing review (client side)
//  Body: { sessionId: number }
//
//  Launches local RV with -networkConnect <hostIp> <port>
// ═══════════════════════════════════════════
router.post('/join', (req, res) => {
    const { sessionId } = req.body || {};

    if (!sessionId) {
        return res.status(400).json({ error: 'Provide a sessionId' });
    }

    const db = getDb();
    const session = db.prepare(
        `SELECT * FROM review_sessions WHERE id = ? AND status = 'active'`
    ).get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found or no longer active' });
    }

    const rvExe = findRV();
    if (!rvExe) {
        return res.status(404).json({ error: 'RV not found on this machine' });
    }

    // Resolve files locally (may differ from host due to path mappings)
    let assetIds = [];
    try {
        const parsed = JSON.parse(session.asset_ids || '[]');
        assetIds = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch { /* empty */ }
    const filePaths = resolveAssetPaths(assetIds);

    // Launch RV as sync client — it will connect to the host's session
    try {
        launchRVAsClient(rvExe, session.host_ip, session.host_port, filePaths);
    } catch (err) {
        return res.status(500).json({ error: `Failed to launch RV: ${err.message}` });
    }

    const userName = req.headers['x-cam-user'] || 'Unknown';
    logActivity('review_join', 'review_session', session.id,
        `${userName} joined sync review: ${session.title}`);

    res.json({
        success: true,
        message: `Joined review "${session.title}" — connecting to ${session.host_ip}:${session.host_port}`,
    });
});


// ═══════════════════════════════════════════
//  POST /api/review/end — End a review session (host side)
//  Body: { sessionId: number }
// ═══════════════════════════════════════════
router.post('/end', (req, res) => {
    const { sessionId } = req.body || {};

    if (!sessionId) {
        return res.status(400).json({ error: 'Provide a sessionId' });
    }

    const db = getDb();
    const session = db.prepare(
        `SELECT * FROM review_sessions WHERE id = ? AND status = 'active'`
    ).get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found or already ended' });
    }

    db.prepare(`UPDATE review_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`)
        .run(sessionId);

    logActivity('review_end', 'review_session', sessionId,
        `Sync review ended: ${session.title}`);

    // Broadcast session end to all spokes
    // Keep asset_ids as a JSON string so spoke's _applyChange stores it correctly in SQLite
    const updated = db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(sessionId);

    req.app.locals.broadcastChange?.('review_sessions', 'update', { record: updated });

    // In spoke mode, also update the hub DB
    const spokeService = req.app.locals.spokeService;
    if (spokeService) {
        spokeService.forwardRequest('POST', '/api/sync/write', {
            method: 'POST',
            path: '/api/review/hub-end',
            body: { session_key: session.session_key },
            spokeName: spokeService.localName,
        }).then(() => {
            console.log(`[SyncReview] Session end forwarded to hub`);
        }).catch(err => {
            console.error(`[SyncReview] Failed to end session on hub:`, err.message);
        });
    }

    res.json({ success: true, message: 'Review session ended' });
});


// ═══════════════════════════════════════════
//  RV LAUNCH HELPERS
// ═══════════════════════════════════════════

/**
 * Launch RV as the sync host (other RVs will connect to this one).
 * Uses `-networkPort` to open a sync server.
 */
function launchRVAsHost(rvExe, filePaths, networkPort) {
    const { execFile, spawn } = require('child_process');

    if (process.platform === 'darwin') {
        // macOS: use `open -a` with the .app bundle for proper window activation
        let appBundle = null;
        let dir = rvExe;
        for (let i = 0; i < 5; i++) {
            dir = path.dirname(dir);
            if (dir.endsWith('.app')) { appBundle = dir; break; }
        }
        if (appBundle) {
            const args = ['-a', appBundle, '--args',
                '-network',
                '-networkPort', String(networkPort),
                ...filePaths
            ];
            execFile('/usr/bin/open', args, { cwd: path.dirname(rvExe) });
            console.log(`[RV Sync] Host launched via 'open -a' (macOS), port ${networkPort}, ${filePaths.length} file(s)`);
            return;
        }
    }

    // Windows / Linux or fallback
    const args = ['-network', '-networkPort', String(networkPort), ...filePaths];
    const child = spawn(rvExe, args, {
        cwd: path.dirname(rvExe),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
    });

    child.stdout.on('data', d => {
        const msg = d.toString().trim();
        if (msg) console.log(`[RV Sync Host] stdout: ${msg.substring(0, 300)}`);
    });
    child.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg) console.error(`[RV Sync Host] stderr: ${msg.substring(0, 300)}`);
    });
    child.on('error', err => console.error(`[RV Sync Host] Error: ${err.message}`));
    child.on('exit', (code) => console.log(`[RV Sync Host] Exited (code=${code})`));
    child.unref();

    console.log(`[RV Sync] Host launched, port ${networkPort}, PID=${child.pid}, ${filePaths.length} file(s)`);
}

/**
 * Launch RV as a sync client (connects to an existing host session).
 * Uses `-networkConnect <ip> <port>` to join the host.
 * Also loads the same media files locally (RV sync shares state, not pixels).
 */
function launchRVAsClient(rvExe, hostIp, hostPort, filePaths) {
    const { execFile, spawn } = require('child_process');

    if (process.platform === 'darwin') {
        let appBundle = null;
        let dir = rvExe;
        for (let i = 0; i < 5; i++) {
            dir = path.dirname(dir);
            if (dir.endsWith('.app')) { appBundle = dir; break; }
        }
        if (appBundle) {
            const args = ['-a', appBundle, '--args',
                '-network',
                '-networkConnect', hostIp, String(hostPort),
                ...filePaths
            ];
            execFile('/usr/bin/open', args, { cwd: path.dirname(rvExe) });
            console.log(`[RV Sync] Client launched via 'open -a' (macOS), connecting to ${hostIp}:${hostPort}`);
            return;
        }
    }

    // Windows / Linux or fallback
    const args = ['-network', '-networkConnect', hostIp, String(hostPort), ...filePaths];
    const child = spawn(rvExe, args, {
        cwd: path.dirname(rvExe),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
    });

    child.stdout.on('data', d => {
        const msg = d.toString().trim();
        if (msg) console.log(`[RV Sync Client] stdout: ${msg.substring(0, 300)}`);
    });
    child.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg) console.error(`[RV Sync Client] stderr: ${msg.substring(0, 300)}`);
    });
    child.on('error', err => console.error(`[RV Sync Client] Error: ${err.message}`));
    child.on('exit', (code) => console.log(`[RV Sync Client] Exited (code=${code})`));
    child.unref();

    console.log(`[RV Sync] Client launched, connecting to ${hostIp}:${hostPort}, PID=${child.pid}`);
}


// ═══════════════════════════════════════════
//  HUB-SIDE ENDPOINTS (called via spoke write-proxy)
//  These run ONLY on the hub to persist review sessions in the hub DB.
// ═══════════════════════════════════════════

/**
 * POST /api/review/hub-register — Register a spoke's review session on the hub DB.
 * Called by the spoke's /start handler via forwardRequest.
 */
router.post('/hub-register', (req, res) => {
    const { session_key, host_name, host_ip, host_port, asset_ids, title, started_by } = req.body || {};

    if (!session_key || !host_ip) {
        return res.status(400).json({ error: 'Missing session_key or host_ip' });
    }

    const db = getDb();

    const result = db.prepare(`
        INSERT OR REPLACE INTO review_sessions (session_key, host_name, host_ip, host_port, status, asset_ids, title, started_by)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(session_key, host_name || 'unknown', host_ip, host_port || 45128,
           JSON.stringify(asset_ids || []), title || 'Sync Review', started_by || 'Unknown');

    const sessionId = Number(result.lastInsertRowid);

    logActivity('review_start', 'review_session', sessionId,
        `Spoke review registered: ${title} from ${host_name}`);

    // Broadcast to all connected spokes so they see the review
    // Keep asset_ids as a JSON string so spoke's _applyChange stores it correctly in SQLite
    const session = db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(sessionId);
    req.app.locals.broadcastChange?.('review_sessions', 'insert', { record: session });

    console.log(`[SyncReview] Hub registered spoke review: "${title}" at ${host_ip}:${host_port}`);
    res.json({ success: true, id: sessionId });
});

/**
 * POST /api/review/hub-end — End a review session on the hub DB.
 * Called by the spoke's /end handler via forwardRequest.
 */
router.post('/hub-end', (req, res) => {
    const { session_key } = req.body || {};

    if (!session_key) {
        return res.status(400).json({ error: 'Missing session_key' });
    }

    const db = getDb();
    const session = db.prepare(
        `SELECT * FROM review_sessions WHERE session_key = ? AND status = 'active'`
    ).get(session_key);

    if (!session) {
        return res.status(404).json({ error: 'Session not found or already ended' });
    }

    db.prepare(`UPDATE review_sessions SET status = 'ended', ended_at = datetime('now') WHERE session_key = ?`)
        .run(session_key);

    logActivity('review_end', 'review_session', session.id,
        `Spoke review ended on hub: ${session.title}`);

    // Broadcast to all spokes
    const updated = db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(session.id);
    try { updated.asset_ids = JSON.parse(updated.asset_ids || '[]'); } catch { updated.asset_ids = []; }
    req.app.locals.broadcastChange?.('review_sessions', 'update', { record: updated });

    console.log(`[SyncReview] Hub ended spoke review: "${session.title}"`);
    res.json({ success: true });
});


module.exports = router;
