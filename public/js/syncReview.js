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
const POLL_INTERVAL = 10000; // 10 seconds

// ─── API ───

/**
 * Fetch active review sessions from the server.
 */
async function fetchReviews() {
    try {
        const data = await api('/api/review/sessions');
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
        showToast('Failed to end review: ' + err.message, 5000);
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
        container.innerHTML = '<div class="review-empty">No active review sessions</div>';
        return;
    }

    let html = '';
    for (const session of activeReviews) {
        const assetCount = Array.isArray(session.asset_ids) ? session.asset_ids.length : 0;
        const startedAgo = formatTimeAgo(session.started_at);

        html += `
        <div class="review-session-card" data-session-id="${session.id}">
            <div class="review-session-header">
                <span class="review-session-title">${escHtml(session.title || 'Untitled Review')}</span>
                <span class="review-session-status">LIVE</span>
            </div>
            <div class="review-session-meta">
                <span>Host: <strong>${escHtml(session.host_name)}</strong></span>
                <span>${assetCount} asset${assetCount !== 1 ? 's' : ''}</span>
                <span>Started ${startedAgo}</span>
            </div>
            <div class="review-session-info">
                <span class="review-session-endpoint">${session.host_ip}:${session.host_port}</span>
                <span class="review-session-by">by ${escHtml(session.started_by || 'Unknown')}</span>
            </div>
            <div class="review-session-actions">
                <button class="btn-small btn-join" onclick="joinReview(${session.id})" title="Launch your local RV and connect to this review session">Join Review</button>
                <button class="btn-small btn-end" onclick="endReview(${session.id})" title="End this review session">End</button>
            </div>
        </div>`;
    }

    container.innerHTML = html;
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
    if (!isVisible) fetchReviews();
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
window.toggleReviewPanel = toggleReviewPanel;
window.startSyncReviewFromSelection = startSyncReviewFromSelection;

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
