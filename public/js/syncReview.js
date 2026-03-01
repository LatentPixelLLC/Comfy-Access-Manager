/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * RV Sync Review — Frontend module for managing synchronized review sessions.
 *
 * Enables multi-user review: one user hosts an RV session, others join.
 * RV handles all sync (scrub, playback, annotations). CAM handles orchestration.
 */

import { api } from './api.js';
import { showToast } from './utils.js';

// ─── State ───
let activeReviews = [];
let pollTimer = null;
let filterProjectId = null;  // null = show all, number = filter to project
const POLL_INTERVAL = 10000; // 10 seconds

// ─── API ───

/**
 * Fetch active review sessions from the server.
 */
async function fetchReviews() {
    try {
        const params = filterProjectId ? `?project_id=${filterProjectId}` : '';
        const data = await api(`/api/review/sessions${params}`);
        activeReviews = data.sessions || [];
        renderReviewPanel();
        updateBadge();
    } catch (err) {
        console.error('[SyncReview] Failed to fetch sessions:', err.message);
    }
}

/**
 * Start a new sync review with the given asset IDs.
 */
async function startSyncReview(assetIds, title) {
    if (!assetIds || assetIds.length === 0) {
        showToast('Select assets for the review', 4000);
        return;
    }

    try {
        const res = await api('/api/review/start', {
            method: 'POST',
            body: {
                assetIds,
                title: title || undefined,
            }
        });

        if (res.success) {
            showToast(`Sync Review started — others can join from the Reviews panel`, 5000);
            // Show the panel
            const panel = document.getElementById('reviewPanel');
            if (panel) panel.style.display = '';
            await fetchReviews();
        } else {
            showToast(res.error || 'Failed to start review', 5000);
        }
    } catch (err) {
        showToast('Failed to start sync review: ' + err.message, 5000);
    }
}

/**
 * Join an existing review session.
 */
async function joinReview(sessionId) {
    try {
        const res = await api('/api/review/join', {
            method: 'POST',
            body: { sessionId }
        });

        if (res.success) {
            showToast(res.message || 'Joined review session', 4000);
        } else {
            showToast(res.error || 'Failed to join review', 5000);
        }
    } catch (err) {
        showToast('Failed to join review: ' + err.message, 5000);
    }
}

/**
 * End a review session (host only).
 */
async function endReview(sessionId) {
    try {
        const res = await api('/api/review/end', {
            method: 'POST',
            body: { sessionId }
        });

        if (res.success) {
            showToast('Review session ended', 3000);
            await fetchReviews();
        } else {
            showToast(res.error || 'Failed to end review', 5000);
        }
    } catch (err) {
        showToast(err.message || 'Failed to end review', 5000);
    }
}

/**
 * Leave a review session (non-host). Kills local RV but keeps the session alive for others.
 */
async function leaveReview(sessionId) {
    try {
        const res = await api('/api/review/leave', {
            method: 'POST',
            body: { sessionId }
        });

        if (res.success) {
            showToast(res.message || 'Left review session', 3000);
        } else {
            showToast(res.error || 'Failed to leave review', 5000);
        }
    } catch (err) {
        showToast(err.message || 'Failed to leave review', 5000);
    }
}


// ─── UI Rendering ───

/**
 * Render the active reviews list inside the review panel.
 */
function renderReviewPanel() {
    const container = document.getElementById('reviewSessionsList');
    if (!container) return;

    if (activeReviews.length === 0) {
        container.innerHTML = `<div class="review-empty">No active review sessions${filterProjectId ? ' for this project' : ''}</div>`;
        return;
    }

    // Group sessions by project
    const grouped = {};
    const noProject = [];
    for (const session of activeReviews) {
        if (session.project_name) {
            if (!grouped[session.project_name]) grouped[session.project_name] = [];
            grouped[session.project_name].push(session);
        } else {
            noProject.push(session);
        }
    }

    let html = '';

    // Render grouped by project
    for (const [projectName, sessions] of Object.entries(grouped)) {
        html += `<div class="review-project-group">`;
        html += `<div class="review-project-label">${escHtml(projectName)}</div>`;
        for (const session of sessions) {
            html += renderSessionCard(session);
        }
        html += `</div>`;
    }

    // Render ungrouped sessions
    if (noProject.length > 0 && Object.keys(grouped).length > 0) {
        html += `<div class="review-project-group">`;
        html += `<div class="review-project-label" style="opacity:0.5">Other</div>`;
        for (const session of noProject) {
            html += renderSessionCard(session);
        }
        html += `</div>`;
    } else {
        for (const session of noProject) {
            html += renderSessionCard(session);
        }
    }

    container.innerHTML = html;
}

/**
 * Render a single review session card with asset details.
 */
function renderSessionCard(session) {
    const assetCount = Array.isArray(session.asset_ids) ? session.asset_ids.length : 0;
    const startedAgo = formatTimeAgo(session.started_at);

    // Build asset name list (show up to 3 names, then "+N more")
    let assetNames = '';
    if (session.assets && session.assets.length > 0) {
        const maxShow = 3;
        const shown = session.assets.slice(0, maxShow);
        const names = shown.map(a => escHtml(a.vault_name || `Asset #${a.id}`)).join(', ');
        const remaining = session.assets.length - maxShow;
        assetNames = remaining > 0 ? `${names} +${remaining} more` : names;
    } else if (assetCount > 0) {
        assetNames = `${assetCount} asset${assetCount !== 1 ? 's' : ''}`;
    }

    // Project badge
    const projectBadge = session.project_name
        ? `<span class="review-project-badge">${escHtml(session.project_code || session.project_name)}</span>`
        : '';

    // Action buttons: host sees "End", others see "Leave"
    let actionButtons;
    if (session.is_owner) {
        actionButtons = `
            <button class="btn-small btn-end" onclick="endReview(${session.id})" title="End this review session for all participants">\u2715 End Session</button>
        `;
    } else {
        actionButtons = `
            <button class="btn-small btn-join" onclick="joinReview(${session.id})" title="Opens RV on your machine and connects to the host's synced session">
                \u25B6 Join &amp; Launch RV
            </button>
            <button class="btn-small btn-leave" onclick="leaveReview(${session.id})" title="Disconnect your RV — the session stays active for others">\u21A9 Leave</button>
        `;
    }

    return `
    <div class="review-session-card${session.is_owner ? ' review-session-owned' : ''}" data-session-id="${session.id}">
        <div class="review-session-header">
            <span class="review-session-title">${escHtml(session.title || 'Untitled Review')}</span>
            ${session.is_owner ? '<span class="review-session-owner-badge">YOUR SESSION</span>' : ''}
            <span class="review-session-status">\u25CF LIVE</span>
        </div>
        <div class="review-session-meta">
            ${projectBadge}
            <span>Host: <strong>${escHtml(session.host_name)}</strong></span>
            <span>by <strong>${escHtml(session.started_by || 'Unknown')}</strong></span>
            <span>${startedAgo}</span>
        </div>
        ${assetNames ? `<div class="review-session-assets" title="${escHtml(assetNames)}">\uD83C\uDFAC ${assetNames}</div>` : ''}
        <div class="review-session-actions">
            ${actionButtons}
        </div>
    </div>`;
}

/**
 * Update the badge count on the review button in the header.
 */
function updateBadge() {
    const btn = document.getElementById('reviewBtn');
    const badge = document.getElementById('reviewBadge');
    if (!btn || !badge) return;

    const count = activeReviews.length;
    badge.textContent = count;

    // Always show the button; badge only when there are active reviews
    btn.style.display = '';
    if (count > 0) {
        btn.classList.add('has-reviews');
        badge.style.display = '';
    } else {
        btn.classList.remove('has-reviews');
        badge.style.display = 'none';
    }
}

/**
 * Toggle the review panel visibility.
 */
function toggleReviewPanel() {
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : '';
    if (!isVisible) {
        // Auto-set filter to current project if user is in a project view
        autoSetProjectFilter();
        fetchReviews();
    }
}

/**
 * Auto-set the project filter based on the user's current project context.
 * If they're browsing a project, default to filtering that project's sessions.
 */
async function autoSetProjectFilter() {
    try {
        const { state } = await import('./state.js');
        if (state.currentProject && state.currentProject.id) {
            filterProjectId = state.currentProject.id;
        } else {
            filterProjectId = null;
        }
        renderFilterBar();
    } catch {
        filterProjectId = null;
        renderFilterBar();
    }
}

/**
 * Render the filter bar inside the review panel header area.
 */
function renderFilterBar() {
    const bar = document.getElementById('reviewFilterBar');
    if (!bar) return;

    if (filterProjectId) {
        bar.innerHTML = `
            <span class="review-filter-label">Filtered to current project</span>
            <button class="review-filter-btn" onclick="clearReviewFilter()" title="Show all reviews across all projects">Show All</button>
        `;
        bar.style.display = '';
    } else {
        bar.innerHTML = `<span class="review-filter-label" style="opacity:0.5">Showing all projects</span>`;
        bar.style.display = '';
    }
}

/**
 * Clear the project filter — show all reviews.
 */
function clearReviewFilter() {
    filterProjectId = null;
    renderFilterBar();
    fetchReviews();
}

/**
 * Set the filter to a specific project.
 */
function setReviewProjectFilter(projectId) {
    filterProjectId = projectId || null;
    renderFilterBar();
    fetchReviews();
}


// ─── Polling ───

/**
 * Start polling for active review sessions.
 * Only polls when in hub or spoke mode (standalone doesn't need it for multi-user,
 * but we enable it anyway for future use).
 */
function startPolling() {
    if (pollTimer) return;
    fetchReviews(); // Initial fetch
    pollTimer = setInterval(fetchReviews, POLL_INTERVAL);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}


// ─── Helpers ───

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTimeAgo(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + (isoDate.endsWith('Z') ? '' : 'Z'));
    const now = Date.now();
    const diffMin = Math.floor((now - d.getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * Start a sync review from the selection toolbar (uses current selection).
 */
async function startSyncReviewFromSelection() {
    const { state } = await import('./state.js');
    if (!state.selectedAssets || state.selectedAssets.length === 0) {
        showToast('Select assets first, then start a sync review', 4000);
        return;
    }
    await startSyncReview([...state.selectedAssets]);
}


// ─── Expose to global scope ───
window.startSyncReview = startSyncReview;
window.joinReview = joinReview;
window.endReview = endReview;
window.leaveReview = leaveReview;
window.toggleReviewPanel = toggleReviewPanel;
window.startSyncReviewFromSelection = startSyncReviewFromSelection;
window.clearReviewFilter = clearReviewFilter;
window.setReviewProjectFilter = setReviewProjectFilter;

// ─── Init ───
// Start polling when module loads
startPolling();

export {
    startSyncReview,
    joinReview,
    endReview,
    fetchReviews,
    toggleReviewPanel,
    startSyncReviewFromSelection,
};
