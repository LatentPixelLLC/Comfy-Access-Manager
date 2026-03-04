/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * EDL Routes — Upload, parse, manage EDLs and launch minicut playback in RV
 */

'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb, logActivity } = require('../database');
const { parseEDL, matchReelToShot } = require('../utils/edlParser');
const { findRV, findRvPush, rvPush, resolveAssetRvPath } = require('../utils/rvFinder');
const { resolveFilePath } = require('../utils/pathResolver');

// Multer for EDL file uploads (small text files, temp storage)
const upload = multer({
    dest: path.join(__dirname, '..', '..', 'data', 'uploads'),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.edl', '.txt'].includes(ext)) cb(null, true);
        else cb(new Error('Only .edl and .txt files are accepted'), false);
    },
});


// ═══════════════════════════════════════════
//  EDL CRUD
// ═══════════════════════════════════════════

/**
 * POST /api/edl/:projectId/upload
 * Upload and parse a CMX3600 EDL file. Creates an edit_context + edit_entries.
 * Body (multipart): edl (file), fps (optional, default 24)
 */
router.post('/:projectId/upload', upload.single('edl'), (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

    // Verify project exists
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!req.file) return res.status(400).json({ error: 'No EDL file uploaded' });

    const fps = parseFloat(req.body.fps) || 24;
    const edlText = fs.readFileSync(req.file.path, 'utf-8');

    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    const { title, events } = parseEDL(edlText, fps);
    if (events.length === 0) {
        return res.status(400).json({ error: 'No valid cut events found in EDL file' });
    }

    const contextName = title || path.basename(req.file.originalname, path.extname(req.file.originalname));

    // Get all shots for this project (across all sequences) for auto-matching
    const shots = db.prepare(
        'SELECT id, name, code FROM shots WHERE project_id = ?'
    ).all(projectId);

    // Insert context
    const insertContext = db.prepare(
        'INSERT INTO edit_contexts (project_id, name, fps, filename, is_active) VALUES (?, ?, ?, ?, 0)'
    );
    const result = insertContext.run(projectId, contextName, fps, req.file.originalname);
    const contextId = result.lastInsertRowid;

    // Insert entries with auto-matching
    const insertEntry = db.prepare(
        `INSERT INTO edit_entries (context_id, cut_order, event_num, reel_name, shot_id, source_in, source_out, record_in, record_out, duration_frames)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let matched = 0;
    let unmatched = 0;
    const entries = [];

    const insertAll = db.transaction(() => {
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const matchResult = matchReelToShot(ev.reelName, shots);
            const shotId = matchResult.shotId;

            if (shotId) matched++;
            else unmatched++;

            insertEntry.run(
                contextId, i + 1, ev.eventNum, ev.reelName,
                shotId, ev.sourceIn, ev.sourceOut,
                ev.recordIn, ev.recordOut, ev.durationFrames
            );

            entries.push({
                cutOrder: i + 1,
                eventNum: ev.eventNum,
                reelName: ev.reelName,
                shotId,
                confidence: matchResult.confidence,
                sourceIn: ev.sourceIn,
                sourceOut: ev.sourceOut,
                recordIn: ev.recordIn,
                recordOut: ev.recordOut,
                durationFrames: ev.durationFrames,
            });
        }
    });
    insertAll();

    // If this is the first EDL for the project, auto-activate it
    const count = db.prepare('SELECT COUNT(*) as c FROM edit_contexts WHERE project_id = ?').get(projectId);
    if (count.c === 1) {
        db.prepare('UPDATE edit_contexts SET is_active = 1 WHERE id = ?').run(contextId);
    }

    // Broadcast for hub-spoke sync
    req.app.locals.broadcastChange?.('edit_contexts', 'insert', {
        record: { id: contextId, project_id: projectId, name: contextName, fps, filename: req.file.originalname, is_active: count.c === 1 ? 1 : 0 }
    });

    logActivity('edl_upload', 'edit_context', contextId, {
        projectId, filename: req.file.originalname, events: events.length, matched, unmatched
    });

    res.json({
        id: contextId,
        name: contextName,
        fps,
        filename: req.file.originalname,
        totalEvents: events.length,
        matched,
        unmatched,
        entries,
    });
});


/**
 * GET /api/edl/:projectId
 * List all EDLs for a project.
 */
router.get('/:projectId', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

    const edls = db.prepare(
        `SELECT ec.*, 
            (SELECT COUNT(*) FROM edit_entries WHERE context_id = ec.id) as entry_count,
            (SELECT COUNT(*) FROM edit_entries WHERE context_id = ec.id AND shot_id IS NOT NULL) as matched_count
         FROM edit_contexts ec
         WHERE ec.project_id = ?
         ORDER BY ec.created_at DESC`
    ).all(projectId);

    res.json(edls);
});


/**
 * GET /api/edl/:projectId/:edlId/entries
 * Get all entries for a specific EDL, with shot names for matched entries.
 */
router.get('/:projectId/:edlId/entries', (req, res) => {
    const db = getDb();
    const edlId = parseInt(req.params.edlId);
    if (!edlId) return res.status(400).json({ error: 'Invalid EDL ID' });

    const entries = db.prepare(
        `SELECT ee.*, sh.name as shot_name, sh.code as shot_code,
                s.name as sequence_name, s.code as sequence_code
         FROM edit_entries ee
         LEFT JOIN shots sh ON sh.id = ee.shot_id
         LEFT JOIN sequences s ON s.id = sh.sequence_id
         WHERE ee.context_id = ?
         ORDER BY ee.cut_order`
    ).all(edlId);

    res.json(entries);
});


/**
 * PUT /api/edl/:projectId/:edlId/active
 * Set an EDL as the active one for this project (deactivates others).
 */
router.put('/:projectId/:edlId/active', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);
    const edlId = parseInt(req.params.edlId);

    db.transaction(() => {
        db.prepare('UPDATE edit_contexts SET is_active = 0 WHERE project_id = ?').run(projectId);
        db.prepare('UPDATE edit_contexts SET is_active = 1 WHERE id = ? AND project_id = ?').run(edlId, projectId);
    })();

    req.app.locals.broadcastChange?.('edit_contexts', 'update', { id: edlId, record: { is_active: 1 } });

    res.json({ success: true });
});


/**
 * POST /api/edl/:projectId/:edlId/entries/:entryId/link
 * Manually link an EDL entry to a shot.
 * Body: { shotId: number|null }
 */
router.post('/:projectId/:edlId/entries/:entryId/link', (req, res) => {
    const db = getDb();
    const entryId = parseInt(req.params.entryId);
    const shotId = req.body.shotId != null ? parseInt(req.body.shotId) : null;

    db.prepare('UPDATE edit_entries SET shot_id = ? WHERE id = ?').run(shotId, entryId);

    req.app.locals.broadcastChange?.('edit_entries', 'update', { id: entryId, record: { shot_id: shotId } });

    res.json({ success: true });
});


/**
 * POST /api/edl/:projectId/:edlId/rematch
 * Re-run auto-matching for all entries in this EDL.
 */
router.post('/:projectId/:edlId/rematch', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);
    const edlId = parseInt(req.params.edlId);

    const shots = db.prepare('SELECT id, name, code FROM shots WHERE project_id = ?').all(projectId);
    const entries = db.prepare('SELECT id, reel_name FROM edit_entries WHERE context_id = ?').all(edlId);

    let matched = 0;
    const update = db.prepare('UPDATE edit_entries SET shot_id = ? WHERE id = ?');

    db.transaction(() => {
        for (const entry of entries) {
            const result = matchReelToShot(entry.reel_name, shots);
            update.run(result.shotId, entry.id);
            if (result.shotId) matched++;
        }
    })();

    res.json({ total: entries.length, matched, unmatched: entries.length - matched });
});


/**
 * DELETE /api/edl/:projectId/:edlId
 * Delete an EDL and all its entries.
 */
router.delete('/:projectId/:edlId', (req, res) => {
    const db = getDb();
    const edlId = parseInt(req.params.edlId);

    db.transaction(() => {
        db.prepare('DELETE FROM edit_entries WHERE context_id = ?').run(edlId);
        db.prepare('DELETE FROM edit_contexts WHERE id = ?').run(edlId);
    })();

    req.app.locals.broadcastChange?.('edit_contexts', 'delete', { id: edlId });

    logActivity('edl_delete', 'edit_context', edlId, {});
    res.json({ success: true });
});


// ═══════════════════════════════════════════
//  MINICUT PLAYBACK
// ═══════════════════════════════════════════

/**
 * POST /api/edl/:projectId/minicut
 * Launch RV with a minicut sequence: the target shot plus N neighbors from the EDL.
 *
 * Body: { shotId: number, neighbors: number (default 2), roleId?: number }
 *
 * Flow:
 *   1. Find the active EDL for this project
 *   2. Find the entry matching this shot
 *   3. Grab N entries before and after (the neighborhood)
 *   4. For each entry, find the best asset (latest version in matching role)
 *   5. Build RV file list with frame-range notation
 *   6. Launch RV in sequence mode
 */
router.post('/:projectId/minicut', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);
    const { shotId, neighbors = 2, roleId } = req.body;

    if (!shotId) return res.status(400).json({ error: 'shotId is required' });

    // Find active EDL
    const activeEdl = db.prepare(
        'SELECT id, fps FROM edit_contexts WHERE project_id = ? AND is_active = 1'
    ).get(projectId);

    if (!activeEdl) {
        return res.status(404).json({ error: 'No active EDL for this project. Upload an EDL first.' });
    }

    // Get all entries for this EDL
    const entries = db.prepare(
        'SELECT * FROM edit_entries WHERE context_id = ? ORDER BY cut_order'
    ).all(activeEdl.id);

    // Find the entry(ies) for this shot
    const shotEntryIndex = entries.findIndex(e => e.shot_id === shotId);
    if (shotEntryIndex === -1) {
        return res.status(404).json({
            error: 'This shot is not found in the active EDL. Link it manually or re-match.'
        });
    }

    // Get neighborhood
    const n = Math.max(0, parseInt(neighbors) || 2);
    const startIdx = Math.max(0, shotEntryIndex - n);
    const endIdx = Math.min(entries.length - 1, shotEntryIndex + n);
    const neighborhood = entries.slice(startIdx, endIdx + 1);

    // For each entry in the neighborhood, find the best asset to play
    const filePaths = [];
    const summary = [];

    for (const entry of neighborhood) {
        if (!entry.shot_id) {
            summary.push({ reelName: entry.reel_name, status: 'unlinked', file: null });
            continue;
        }

        // Find assets for this shot, optionally filtered by role
        let assetQuery = `
            SELECT a.*, r.name as role_name, r.code as role_code
            FROM assets a
            LEFT JOIN roles r ON r.id = a.role_id
            WHERE a.shot_id = ? AND a.media_type IN ('video', 'image', 'exr')
        `;
        const params = [entry.shot_id];

        if (roleId) {
            assetQuery += ' AND a.role_id = ?';
            params.push(roleId);
        }

        // Prefer latest version: sort by version DESC, then by created_at DESC
        assetQuery += ' ORDER BY a.version DESC, a.created_at DESC LIMIT 1';

        const asset = db.prepare(assetQuery).get(...params);

        if (asset) {
            const rvPath = resolveAssetRvPath(asset);
            if (rvPath) {
                filePaths.push(rvPath);
                summary.push({
                    reelName: entry.reel_name,
                    shotId: entry.shot_id,
                    status: 'found',
                    file: rvPath,
                    assetName: asset.vault_name,
                    isCurrent: entry.shot_id === shotId,
                });
            } else {
                summary.push({ reelName: entry.reel_name, shotId: entry.shot_id, status: 'file_missing', file: null });
            }
        } else {
            summary.push({ reelName: entry.reel_name, shotId: entry.shot_id, status: 'no_asset', file: null });
        }
    }

    if (filePaths.length === 0) {
        return res.status(404).json({
            error: 'No playable media found for any shots in the minicut range',
            summary,
        });
    }

    // Launch RV
    const rvExe = findRV();
    if (!rvExe) {
        return res.status(404).json({ error: 'RV not found. Install OpenRV or set rv_path in Settings.' });
    }

    // Try rvpush first (set = replace current, sequence layout)
    const pushExe = findRvPush();
    if (pushExe) {
        const pushResult = rvPush(pushExe, filePaths, 'set');
        if (pushResult.success) {
            return res.json({
                success: true,
                totalEntries: neighborhood.length,
                playableFiles: filePaths.length,
                summary,
                message: `Pushed ${filePaths.length} files to RV (minicut around shot)`,
            });
        }
    }

    // Launch fresh RV in sequence mode
    const { spawn, execFile } = require('child_process');
    const cwd = path.dirname(rvExe);

    // RV args: -l sequence tells RV to lay out clips sequentially (timeline)
    const args = ['-l', 'sequence', ...filePaths];

    if (process.platform === 'darwin') {
        let appBundle = null;
        let dir = rvExe;
        for (let i = 0; i < 5; i++) {
            dir = path.dirname(dir);
            if (dir.endsWith('.app')) { appBundle = dir; break; }
        }
        if (appBundle) {
            execFile('/usr/bin/open', ['-n', '-a', appBundle, '--args', ...args], { cwd });
        } else {
            const child = spawn(rvExe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
            child.unref();
        }
    } else {
        const child = spawn(rvExe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
    }

    console.log(`[Minicut] Launched RV with ${filePaths.length} files for shot ID ${shotId}`);

    res.json({
        success: true,
        totalEntries: neighborhood.length,
        playableFiles: filePaths.length,
        summary,
        message: `Launched RV with ${filePaths.length} minicut files`,
    });
});


/**
 * GET /api/edl/:projectId/active-info
 * Quick check: does this project have an active EDL? Used by UI to show/hide minicut options.
 */
router.get('/:projectId/active-info', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);

    const activeEdl = db.prepare(
        `SELECT ec.id, ec.name, ec.fps,
            (SELECT COUNT(*) FROM edit_entries WHERE context_id = ec.id) as entry_count,
            (SELECT COUNT(*) FROM edit_entries WHERE context_id = ec.id AND shot_id IS NOT NULL) as matched_count
         FROM edit_contexts ec
         WHERE ec.project_id = ? AND ec.is_active = 1`
    ).get(projectId);

    res.json({ hasActiveEdl: !!activeEdl, edl: activeEdl || null });
});


module.exports = router;
