/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * User Access — Shared helper for resolving user access from X-CAM-User header.
 * Blacklist model: users see everything EXCEPT explicitly hidden projects.
 *
 * Used by projectRoutes, assetRoutes, and any route that needs user filtering.
 */

const { getDb } = require('../database');

/**
 * Resolve user access from X-CAM-User header.
 * @param {import('express').Request} req
 * @returns {{ userId: number|null, isAdmin: boolean, hiddenIds: null|'all'|Set<number> }}
 *   - hiddenIds === null  → no user header / user not found → should block
 *   - hiddenIds === 'all' → admin → sees everything
 *   - hiddenIds is Set    → project IDs to EXCLUDE from results
 */
function resolveUserAccess(req) {
    const userId = parseInt(req.headers['x-cam-user'], 10);
    if (!userId || isNaN(userId)) return { userId: null, isAdmin: false, hiddenIds: null };

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return { userId: null, isAdmin: false, hiddenIds: null };

    if (user.is_admin) return { userId: user.id, isAdmin: true, hiddenIds: 'all' };

    const rows = db.prepare('SELECT project_id FROM project_hidden WHERE user_id = ?').all(user.id);
    const ids = new Set(rows.map(r => r.project_id));
    return { userId: user.id, isAdmin: false, hiddenIds: ids };
}

module.exports = { resolveUserAccess };
