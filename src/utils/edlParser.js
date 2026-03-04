/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * EDL (Edit Decision List) Parser — CMX3600 format
 *
 * Parses standard CMX3600 EDLs into structured cut entries.
 * Supports timecode parsing, frame-count calculation, and reel-to-shot matching.
 */

'use strict';

/**
 * Parse a timecode string "HH:MM:SS:FF" into total frame count at the given fps.
 * Also accepts "HH:MM:SS;FF" (drop-frame semicolon) — treated as non-drop for simplicity.
 */
function tcToFrames(tc, fps) {
    if (!tc || typeof tc !== 'string') return 0;
    const parts = tc.replace(/;/g, ':').split(':').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return 0;
    const [hh, mm, ss, ff] = parts;
    return Math.round((hh * 3600 + mm * 60 + ss) * fps + ff);
}

/**
 * Convert a total frame count back to "HH:MM:SS:FF" timecode string.
 */
function framesToTc(totalFrames, fps) {
    const f = Math.round(fps);
    let remaining = Math.max(0, Math.round(totalFrames));
    const ff = remaining % f; remaining = Math.floor(remaining / f);
    const ss = remaining % 60; remaining = Math.floor(remaining / 60);
    const mm = remaining % 60;
    const hh = Math.floor(remaining / 60);
    return [hh, mm, ss, ff].map(n => String(n).padStart(2, '0')).join(':');
}

/**
 * Parse a CMX3600 EDL string into an array of cut events.
 *
 * CMX3600 format (simplified):
 *   TITLE: <title>
 *   FCM: NON-DROP FRAME
 *   001  REEL_01  V  C  01:00:00:00 01:00:05:00 01:00:00:00 01:00:05:00
 *   002  REEL_02  V  C  01:00:00:00 01:00:03:12 01:00:05:00 01:00:08:12
 *
 * Each event line: EVENT# REEL TRACK TRANSITION SRC_IN SRC_OUT REC_IN REC_OUT
 *
 * @param {string} edlText - Raw EDL file content
 * @param {number} fps - Frames per second (default 24)
 * @returns {{ title: string, events: Array<{eventNum, reelName, sourceIn, sourceOut, recordIn, recordOut, durationFrames}> }}
 */
function parseEDL(edlText, fps = 24) {
    const lines = edlText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let title = '';
    const events = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Title header
        if (line.startsWith('TITLE:')) {
            title = line.substring(6).trim();
            continue;
        }

        // Skip header lines (FCM, comments, etc.)
        if (line.startsWith('FCM:') || line.startsWith('*') || line.startsWith('>>>')) continue;

        // Event line: starts with a number (event number)
        // Format: EVENT  REEL  TRACK  TRANSITION  SRC_IN  SRC_OUT  REC_IN  REC_OUT
        const eventMatch = line.match(
            /^(\d{1,4})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d{2}:\d{2}:\d{2}[;:]\d{2})\s+(\d{2}:\d{2}:\d{2}[;:]\d{2})\s+(\d{2}:\d{2}:\d{2}[;:]\d{2})\s+(\d{2}:\d{2}:\d{2}[;:]\d{2})/
        );

        if (eventMatch) {
            const [, eventNum, reelName, track, transition, srcIn, srcOut, recIn, recOut] = eventMatch;

            // Skip audio-only tracks and BL (black) reels
            if (track.startsWith('A') && !track.includes('V')) continue;
            if (reelName === 'BL' || reelName === 'AX') continue;

            const srcInFrames = tcToFrames(srcIn, fps);
            const srcOutFrames = tcToFrames(srcOut, fps);
            const recInFrames = tcToFrames(recIn, fps);
            const recOutFrames = tcToFrames(recOut, fps);
            const durationFrames = recOutFrames - recInFrames;

            events.push({
                eventNum,
                reelName,
                track,
                transition,
                sourceIn: srcIn,
                sourceOut: srcOut,
                recordIn: recIn,
                recordOut: recOut,
                durationFrames: Math.max(0, durationFrames),
            });
        }
    }

    return { title, events };
}

/**
 * Try to match reel names from the EDL to shots in the project.
 * Uses three strategies:
 *   1. Exact match (reel_name === shot.code or shot.name, case-insensitive)
 *   2. Contains match (reel_name appears in shot name/code, or vice versa)
 *   3. Normalized match (strip common prefixes/suffixes and compare)
 *
 * @param {string} reelName - Reel name from EDL
 * @param {Array<{id, name, code}>} shots - All shots in the project
 * @returns {{ shotId: number|null, confidence: string }} matched shot ID and match quality
 */
function matchReelToShot(reelName, shots) {
    if (!reelName || !shots || shots.length === 0) return { shotId: null, confidence: 'none' };

    const reel = reelName.trim().toUpperCase();

    // Strategy 1: Exact match on code or name
    for (const shot of shots) {
        const shotCode = (shot.code || '').toUpperCase();
        const shotName = (shot.name || '').toUpperCase();
        if (reel === shotCode || reel === shotName) {
            return { shotId: shot.id, confidence: 'exact' };
        }
    }

    // Strategy 2: Contains match (reel in shot or shot in reel)
    for (const shot of shots) {
        const shotCode = (shot.code || '').toUpperCase();
        const shotName = (shot.name || '').toUpperCase();
        if (shotCode && (reel.includes(shotCode) || shotCode.includes(reel))) {
            return { shotId: shot.id, confidence: 'contains' };
        }
        if (shotName && (reel.includes(shotName) || shotName.includes(reel))) {
            return { shotId: shot.id, confidence: 'contains' };
        }
    }

    // Strategy 3: Normalize — strip common prefixes like "SH", trailing versions, underscores
    const normalize = s => s.replace(/^(SH|SHOT|SC|SCENE)[_-]?/i, '')
                            .replace(/[_-]?V\d+$/i, '')
                            .replace(/[_-]/g, '');
    const normReel = normalize(reel);

    for (const shot of shots) {
        const normCode = normalize((shot.code || '').toUpperCase());
        const normName = normalize((shot.name || '').toUpperCase());
        if (normReel && (normReel === normCode || normReel === normName)) {
            return { shotId: shot.id, confidence: 'fuzzy' };
        }
    }

    return { shotId: null, confidence: 'none' };
}

module.exports = { parseEDL, matchReelToShot, tcToFrames, framesToTc };
