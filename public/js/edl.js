/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * EDL / Minicut — frontend module
 *
 * Provides:
 *   - showEdlModal()      — Upload / list / manage EDLs for current project
 *   - playMinicut(shotId)  — Launch minicut playback in RV for a shot
 */

import { state } from './state.js';
import { api } from './api.js';
import { esc, showToast } from './utils.js';

// ═══════════════════════════════════════════
//  EDL MODAL
// ═══════════════════════════════════════════

/**
 * Open the EDL management modal for the current project.
 */
function showEdlModal() {
    const project = state.currentProject;
    if (!project) return showToast('Select a project first', 'error');

    const mc = document.getElementById('modalContent');
    mc.style.maxWidth = '720px';

    mc.innerHTML = `
        <h3>EDL / Minicut  <span style="font-size:.75em;color:var(--text-dim);">${esc(project.name)}</span></h3>
        <p style="color:var(--text-dim);font-size:.82rem;margin-bottom:16px;">
            Upload a CMX3600 EDL to enable minicut playback. Right-click any shot and pick "Play Minicut" to see it in editorial context.
        </p>

        <!-- Upload section -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:18px;">
            <input type="file" id="edlFileInput" accept=".edl,.txt" style="flex:1;">
            <label style="font-size:.8rem;color:var(--text-dim);">FPS:</label>
            <input type="number" id="edlFps" value="24" min="1" max="120" step="0.001"
                   style="width:60px;padding:4px 6px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:.85rem;">
            <button class="btn-primary" onclick="uploadEdl()" style="padding:6px 18px;font-size:.85rem;">Upload EDL</button>
        </div>

        <!-- EDL list -->
        <div id="edlListContainer" style="min-height:60px;">
            <div style="color:var(--text-dim);text-align:center;padding:20px;">Loading...</div>
        </div>

        <!-- Entry detail -->
        <div id="edlEntryContainer" style="display:none;margin-top:16px;"></div>

        <div class="form-actions" style="margin-top:20px;">
            <button class="btn-cancel" onclick="closeModal();document.getElementById('modalContent').style.maxWidth='';">Close</button>
        </div>
    `;

    document.getElementById('modal').style.display = 'flex';
    _loadEdlList(project.id);
}

/**
 * Upload an EDL file for the current project.
 */
async function uploadEdl() {
    const project = state.currentProject;
    if (!project) return;

    const fileInput = document.getElementById('edlFileInput');
    const file = fileInput?.files?.[0];
    if (!file) return showToast('Select an EDL file first', 'error');

    const fps = parseFloat(document.getElementById('edlFps')?.value) || 24;

    const formData = new FormData();
    formData.append('edl', file);
    formData.append('fps', String(fps));

    try {
        const res = await fetch(`/api/edl/${project.id}/upload`, {
            method: 'POST',
            headers: { 'X-CAM-User': state.currentUser?.id || '' },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        showToast(`EDL uploaded: ${data.totalEvents} events (${data.matched} matched, ${data.unmatched} unmatched)`);
        fileInput.value = '';
        _loadEdlList(project.id);
    } catch (err) {
        showToast('EDL upload error: ' + err.message, 'error');
    }
}

/**
 * Load and render the list of EDLs for a project.
 */
async function _loadEdlList(projectId) {
    const container = document.getElementById('edlListContainer');
    if (!container) return;

    try {
        const edls = await api(`/api/edl/${projectId}`);
        if (!edls || edls.length === 0) {
            container.innerHTML = `
                <div style="color:var(--text-dim);text-align:center;padding:20px;border:1px dashed var(--border);border-radius:var(--radius);">
                    No EDLs uploaded yet. Upload a CMX3600 .edl file above.
                </div>`;
            return;
        }

        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border);">
                        <th style="text-align:left;padding:6px 8px;">Name</th>
                        <th style="text-align:center;padding:6px 8px;">Events</th>
                        <th style="text-align:center;padding:6px 8px;">Matched</th>
                        <th style="text-align:center;padding:6px 8px;">FPS</th>
                        <th style="text-align:center;padding:6px 8px;">Active</th>
                        <th style="text-align:right;padding:6px 8px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${edls.map(edl => `
                        <tr style="border-bottom:1px solid var(--border-dim, #333);">
                            <td style="padding:6px 8px;cursor:pointer;color:var(--accent-text, #ccc);" onclick="showEdlEntries(${edl.id})" title="Click to view entries">
                                ${esc(edl.name)}
                                ${edl.filename ? `<span style="font-size:.75em;color:var(--text-dim);margin-left:6px;">(${esc(edl.filename)})</span>` : ''}
                            </td>
                            <td style="text-align:center;padding:6px 8px;">${edl.entry_count}</td>
                            <td style="text-align:center;padding:6px 8px;">
                                <span style="color:${edl.matched_count === edl.entry_count ? '#6a6' : '#ca6'};">
                                    ${edl.matched_count}/${edl.entry_count}
                                </span>
                            </td>
                            <td style="text-align:center;padding:6px 8px;">${edl.fps}</td>
                            <td style="text-align:center;padding:6px 8px;">
                                ${edl.is_active
                                    ? '<span style="color:#6a6;font-weight:600;">Active</span>'
                                    : `<button class="btn-sm" onclick="setActiveEdl(${edl.id})" style="font-size:.75rem;padding:2px 8px;">Set Active</button>`
                                }
                            </td>
                            <td style="text-align:right;padding:6px 8px;">
                                <button class="btn-sm" onclick="rematchEdl(${edl.id})" style="font-size:.75rem;padding:2px 8px;" title="Re-run auto-matching">Re-match</button>
                                <button class="btn-sm btn-subtle" onclick="deleteEdl(${edl.id})" style="font-size:.75rem;padding:2px 8px;color:var(--danger);">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = `<div style="color:var(--danger);padding:12px;">Error loading EDLs: ${esc(err.message)}</div>`;
    }
}

/**
 * Show entries for a specific EDL.
 */
async function showEdlEntries(edlId) {
    const project = state.currentProject;
    if (!project) return;

    const container = document.getElementById('edlEntryContainer');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:12px;">Loading entries...</div>';

    try {
        const entries = await api(`/api/edl/${project.id}/${edlId}/entries`);

        if (!entries || entries.length === 0) {
            container.innerHTML = '<div style="color:var(--text-dim);padding:12px;">No entries found.</div>';
            return;
        }

        // Build shots dropdown for manual linking
        const shots = _getAllProjectShots();
        const shotOptions = shots.map(sh => `<option value="${sh.id}">${esc(sh.seqName ? sh.seqName + ' / ' : '')}${esc(sh.name)} (${esc(sh.code)})</option>`).join('');

        container.innerHTML = `
            <h4 style="margin-bottom:8px;">Cut Entries <button class="btn-sm" onclick="document.getElementById('edlEntryContainer').style.display='none'" style="float:right;font-size:.75rem;">Hide</button></h4>
            <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);">
                <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-card);">
                            <th style="padding:4px 6px;text-align:center;">#</th>
                            <th style="padding:4px 6px;text-align:left;">Reel</th>
                            <th style="padding:4px 6px;text-align:left;">Matched Shot</th>
                            <th style="padding:4px 6px;text-align:center;">Rec In</th>
                            <th style="padding:4px 6px;text-align:center;">Rec Out</th>
                            <th style="padding:4px 6px;text-align:center;">Dur</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${entries.map(e => {
                            const matched = e.shot_id != null;
                            const shotLabel = matched
                                ? `${e.sequence_name ? esc(e.sequence_name) + ' / ' : ''}${esc(e.shot_name || e.shot_code || 'Shot #' + e.shot_id)}`
                                : '';
                            return `
                            <tr style="border-bottom:1px solid var(--border-dim, #333);${matched ? '' : 'background:rgba(180,80,80,0.08);'}">
                                <td style="padding:4px 6px;text-align:center;color:var(--text-dim);">${e.cut_order}</td>
                                <td style="padding:4px 6px;">${esc(e.reel_name)}</td>
                                <td style="padding:4px 6px;">
                                    ${matched
                                        ? `<span style="color:#6a6;">${shotLabel}</span> <button class="btn-sm" onclick="unlinkEdlEntry(${edlId}, ${e.id})" style="font-size:.65rem;padding:1px 4px;margin-left:4px;" title="Unlink">x</button>`
                                        : `<select onchange="linkEdlEntry(${edlId}, ${e.id}, this.value)" style="font-size:.75rem;padding:2px 4px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);">
                                            <option value="">-- Link to shot --</option>
                                            ${shotOptions}
                                           </select>`
                                    }
                                </td>
                                <td style="padding:4px 6px;text-align:center;font-family:monospace;font-size:.75rem;">${esc(e.record_in || '')}</td>
                                <td style="padding:4px 6px;text-align:center;font-family:monospace;font-size:.75rem;">${esc(e.record_out || '')}</td>
                                <td style="padding:4px 6px;text-align:center;font-size:.75rem;">${e.duration_frames || 0}f</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div style="color:var(--danger);padding:12px;">Error loading entries: ${esc(err.message)}</div>`;
    }
}

/**
 * Gather all shots from the current project's sequences (for the link dropdown).
 */
function _getAllProjectShots() {
    const project = state.currentProject;
    if (!project) return [];

    const result = [];
    for (const seq of (project.sequences || [])) {
        for (const sh of (seq.shots || [])) {
            result.push({ id: sh.id, name: sh.name, code: sh.code, seqName: seq.name });
        }
    }
    // Also include orphan shots
    for (const sh of (project.orphanShots || [])) {
        result.push({ id: sh.id, name: sh.name, code: sh.code, seqName: '' });
    }
    return result;
}


// ═══════════════════════════════════════════
//  EDL ACTIONS
// ═══════════════════════════════════════════

async function setActiveEdl(edlId) {
    const project = state.currentProject;
    if (!project) return;

    try {
        await api(`/api/edl/${project.id}/${edlId}/active`, { method: 'PUT' });
        showToast('EDL set as active');
        _loadEdlList(project.id);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function rematchEdl(edlId) {
    const project = state.currentProject;
    if (!project) return;

    try {
        const res = await api(`/api/edl/${project.id}/${edlId}/rematch`, { method: 'POST' });
        showToast(`Re-matched: ${res.matched}/${res.total} entries linked`);
        _loadEdlList(project.id);
        // Refresh entries if visible
        const entryContainer = document.getElementById('edlEntryContainer');
        if (entryContainer?.style.display !== 'none') {
            showEdlEntries(edlId);
        }
    } catch (err) {
        showToast('Re-match error: ' + err.message, 'error');
    }
}

async function deleteEdl(edlId) {
    const project = state.currentProject;
    if (!project) return;

    if (!confirm('Delete this EDL and all its entries?')) return;

    try {
        await api(`/api/edl/${project.id}/${edlId}`, { method: 'DELETE' });
        showToast('EDL deleted');
        _loadEdlList(project.id);
        const entryContainer = document.getElementById('edlEntryContainer');
        if (entryContainer) entryContainer.style.display = 'none';
    } catch (err) {
        showToast('Delete error: ' + err.message, 'error');
    }
}

async function linkEdlEntry(edlId, entryId, shotIdStr) {
    const project = state.currentProject;
    if (!project) return;
    const shotId = shotIdStr ? parseInt(shotIdStr) : null;

    try {
        await api(`/api/edl/${project.id}/${edlId}/entries/${entryId}/link`, {
            method: 'POST', body: { shotId }
        });
        showEdlEntries(edlId);
        _loadEdlList(project.id);
    } catch (err) {
        showToast('Link error: ' + err.message, 'error');
    }
}

async function unlinkEdlEntry(edlId, entryId) {
    const project = state.currentProject;
    if (!project) return;

    try {
        await api(`/api/edl/${project.id}/${edlId}/entries/${entryId}/link`, {
            method: 'POST', body: { shotId: null }
        });
        showEdlEntries(edlId);
        _loadEdlList(project.id);
    } catch (err) {
        showToast('Unlink error: ' + err.message, 'error');
    }
}


// ═══════════════════════════════════════════
//  MINICUT PLAYBACK
// ═══════════════════════════════════════════

/**
 * Launch minicut playback in RV for a specific shot.
 * Opens the shot with its editorial neighbors from the active EDL.
 *
 * @param {number} shotId - Shot ID
 * @param {number} [neighbors=2] - Number of neighboring cuts before/after
 */
async function playMinicut(shotId, neighbors = 2) {
    const project = state.currentProject;
    if (!project) return showToast('Select a project first', 'error');

    try {
        const res = await api(`/api/edl/${project.id}/minicut`, {
            method: 'POST',
            body: { shotId, neighbors }
        });

        if (res.success) {
            showToast(`Minicut: ${res.playableFiles} of ${res.totalEntries} files loaded in RV`);
        } else {
            showToast(res.error || 'Minicut launch failed', 'error');
        }
    } catch (err) {
        showToast('Minicut error: ' + err.message, 'error');
    }
}

/**
 * Check whether the current project has an active EDL (for graying out the menu).
 * Caches per project load so we don't spam the API.
 */
let _activeEdlCache = { projectId: null, hasActiveEdl: false };

async function hasActiveEdl(projectId) {
    if (_activeEdlCache.projectId === projectId) return _activeEdlCache.hasActiveEdl;
    try {
        const res = await api(`/api/edl/${projectId}/active-info`);
        _activeEdlCache = { projectId, hasActiveEdl: !!res.hasActiveEdl };
        return _activeEdlCache.hasActiveEdl;
    } catch {
        return false;
    }
}

/**
 * Invalidate the active EDL cache (call after uploading/deleting EDLs).
 */
function invalidateEdlCache() {
    _activeEdlCache = { projectId: null, hasActiveEdl: false };
}


// ═══════════════════════════════════════════
//  EXPOSE ON WINDOW
// ═══════════════════════════════════════════

window.showEdlModal = showEdlModal;
window.uploadEdl = uploadEdl;
window.showEdlEntries = showEdlEntries;
window.setActiveEdl = setActiveEdl;
window.rematchEdl = rematchEdl;
window.deleteEdl = deleteEdl;
window.linkEdlEntry = linkEdlEntry;
window.unlinkEdlEntry = unlinkEdlEntry;
window.playMinicut = playMinicut;

export { showEdlModal, playMinicut, hasActiveEdl, invalidateEdlCache };
