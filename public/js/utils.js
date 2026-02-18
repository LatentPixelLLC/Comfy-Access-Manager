/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * DMV — Shared Utilities
 * Pure utility functions used across all modules.
 */

export function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export function escAttr(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds) {
    if (!seconds) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr) {
    if (!dateStr) return '';
    // SQLite datetime('now') stores UTC — append 'Z' so JS parses as UTC, then display local
    const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${yr}-${mo}-${dy} ${hh}:${mm}`;
}

export function typeIcon(type) {
    const icons = { video: '🎬', image: '🖼️', audio: '🔊', exr: '✨', threed: '🧊', document: '📄' };
    return icons[type] || '📎';
}

export function showToast(message, duration = 3000) {
    let toast = document.getElementById('mvToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mvToast';
        toast.className = 'mv-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

export function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

/**
 * Ensure a hex color is readable on dark backgrounds.
 * Lightens colors with luminance < 90.
 */
export function ensureReadableColor(hex) {
    if (!hex || hex.length < 4) return '#aaa';
    const raw = hex.replace('#', '');
    const r = parseInt(raw.substring(0, 2), 16) || 0;
    const g = parseInt(raw.substring(2, 4), 16) || 0;
    const b = parseInt(raw.substring(4, 6), 16) || 0;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luminance < 90) {
        const boost = 80;
        const nr = Math.min(255, r + boost);
        const ng = Math.min(255, g + boost);
        const nb = Math.min(255, b + boost);
        return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
    }
    return hex;
}

/**
 * Confirm a destructive action. Respects the confirm_delete preference.
 */
export function confirmDelete(message) {
    const pref = localStorage.getItem('cam_pref_confirm_delete');
    if (pref === 'false') return true;
    return confirm(message);
}

// Expose on window for HTML onclick handlers
window.closeModal = closeModal;
