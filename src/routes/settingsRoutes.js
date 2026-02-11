/**
 * MediaVault - Settings Routes
 * App configuration, watch folders, and system info
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getAllSettings, setSetting, getSetting, getRecentActivity, getDb } = require('../database');
const WatcherService = require('../services/WatcherService');
const FileService = require('../services/FileService');
const MediaInfoService = require('../services/MediaInfoService');
const ThumbnailService = require('../services/ThumbnailService');
const { detectMediaType } = require('../utils/mediaTypes');

// GET /api/settings — All settings
router.get('/', (req, res) => {
    const settings = getAllSettings();
    res.json(settings);
});

// POST /api/settings — Update settings
router.post('/', (req, res) => {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
        setSetting(key, value);
    }

    // If vault_root changed, create it
    if (updates.vault_root) {
        FileService.ensureDir(updates.vault_root);
    }

    // If ComfyUI watch toggle changed, start/stop watcher
    if (updates.comfyui_watch_enabled !== undefined) {
        const comfyPath = getSetting('comfyui_output_path');
        if (updates.comfyui_watch_enabled === 'true' && comfyPath) {
            // Start watching ComfyUI output
            try {
                WatcherService.watchFolder(comfyPath, null, 'comfyui');
            } catch {}
        } else if (comfyPath) {
            WatcherService.unwatchFolder(comfyPath);
        }
    }

    res.json({ success: true, settings: getAllSettings() });
});

// GET /api/settings/status — System status info
router.get('/status', (req, res) => {
    const db = getDb();
    const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
    const assetCount = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;
    const watchCount = db.prepare('SELECT COUNT(*) as count FROM watch_folders WHERE auto_import = 1').get().count;
    
    const vaultRoot = getSetting('vault_root');
    let vaultExists = false;
    let vaultSize = null;

    if (vaultRoot && fs.existsSync(vaultRoot)) {
        vaultExists = true;
    }

    res.json({
        version: require('../../package.json').version,
        projects: projectCount,
        assets: assetCount,
        watchFolders: watchCount,
        vaultRoot,
        vaultConfigured: !!vaultRoot && vaultExists,
        ffmpegAvailable: !!require('../services/ThumbnailService').findFFmpeg(),
    });
});

// POST /api/settings/setup-vault — First-time vault setup
router.post('/setup-vault', (req, res) => {
    const { path: vaultPath } = req.body;
    if (!vaultPath) return res.status(400).json({ error: 'Path required' });

    try {
        FileService.ensureDir(vaultPath);
        setSetting('vault_root', vaultPath);
        res.json({ success: true, path: vaultPath });
    } catch (err) {
        res.status(500).json({ error: `Failed to create vault: ${err.message}` });
    }
});

// POST /api/settings/migrate-vault — Move all vault files to a new location
router.post('/migrate-vault', async (req, res) => {
    // Allow up to 30 minutes for large vaults
    req.setTimeout(30 * 60 * 1000);
    res.setTimeout(30 * 60 * 1000);
    const { oldRoot, newRoot } = req.body;
    if (!oldRoot || !newRoot) return res.status(400).json({ error: 'oldRoot and newRoot required' });
    if (path.resolve(oldRoot) === path.resolve(newRoot)) return res.status(400).json({ error: 'Old and new roots are the same' });
    if (!fs.existsSync(oldRoot)) return res.status(400).json({ error: `Old vault not found: ${oldRoot}` });

    try {
        // 1. Ensure new root exists
        FileService.ensureDir(newRoot);

        // 2. Recursively copy all contents from old vault to new vault
        const copyDir = (src, dest) => {
            let count = 0;
            FileService.ensureDir(dest);
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    count += copyDir(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                    count++;
                }
            }
            return count;
        };

        // Only copy vault content directories (project folders, thumbnails, etc.)
        // Skip the database file and app code
        const oldNorm = path.resolve(oldRoot);
        const appDir = path.resolve(__dirname, '..', '..');
        let filesCopied = 0;

        const topEntries = fs.readdirSync(oldRoot, { withFileTypes: true });
        for (const entry of topEntries) {
            const srcFull = path.join(oldRoot, entry.name);
            const destFull = path.join(newRoot, entry.name);
            // Skip if it's the app directory itself (e.g. vault is inside app folder)
            if (path.resolve(srcFull) === appDir) continue;
            // Skip node_modules, src, public, package.json etc
            if (['node_modules', 'src', 'public', 'comfyui', 'package.json', 'package-lock.json', 'start.bat', '.git'].includes(entry.name)) continue;

            if (entry.isDirectory()) {
                filesCopied += copyDir(srcFull, destFull);
            } else {
                FileService.ensureDir(newRoot);
                fs.copyFileSync(srcFull, destFull);
                filesCopied++;
            }
        }

        // 3. Update all database paths
        const db = getDb();
        const oldPrefix = oldNorm.replace(/\\/g, '\\');
        const newPrefix = path.resolve(newRoot).replace(/\\/g, '\\');

        // Assets: file_path and thumbnail_path
        const assets = db.prepare('SELECT id, file_path, thumbnail_path FROM assets').all();
        const updateAsset = db.prepare('UPDATE assets SET file_path = ?, thumbnail_path = ? WHERE id = ?');
        let pathsUpdated = 0;
        for (const a of assets) {
            let fp = a.file_path;
            let tp = a.thumbnail_path;
            let changed = false;
            if (fp && fp.startsWith(oldPrefix)) {
                fp = newPrefix + fp.slice(oldPrefix.length);
                changed = true;
            }
            if (tp && tp.startsWith(oldPrefix)) {
                tp = newPrefix + tp.slice(oldPrefix.length);
                changed = true;
            }
            if (changed) {
                updateAsset.run(fp, tp, a.id);
                pathsUpdated++;
            }
        }

        // ComfyUI mappings: file_path
        const mappings = db.prepare('SELECT id, file_path FROM comfyui_mappings').all();
        const updateMapping = db.prepare('UPDATE comfyui_mappings SET file_path = ? WHERE id = ?');
        for (const m of mappings) {
            if (m.file_path && m.file_path.startsWith(oldPrefix)) {
                updateMapping.run(newPrefix + m.file_path.slice(oldPrefix.length), m.id);
            }
        }

        // 4. Update vault_root setting
        setSetting('vault_root', newRoot);

        // 5. Remove old vault directory contents (only the stuff we copied)
        let cleaned = 0;
        const removeDir = (dir) => {
            let c = 0;
            if (!fs.existsSync(dir)) return c;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    c += removeDir(fullPath);
                    fs.rmdirSync(fullPath);
                } else {
                    fs.unlinkSync(fullPath);
                    c++;
                }
            }
            return c;
        };

        for (const entry of topEntries) {
            if (['node_modules', 'src', 'public', 'comfyui', 'package.json', 'package-lock.json', 'start.bat', '.git'].includes(entry.name)) continue;
            const srcFull = path.join(oldRoot, entry.name);
            if (path.resolve(srcFull) === appDir) continue;
            if (!fs.existsSync(srcFull)) continue;

            if (entry.isDirectory()) {
                cleaned += removeDir(srcFull);
                try { fs.rmdirSync(srcFull); } catch {}
            } else {
                fs.unlinkSync(srcFull);
                cleaned++;
            }
        }

        res.json({
            success: true,
            filesCopied,
            pathsUpdated,
            cleaned,
            newRoot,
        });

    } catch (err) {
        console.error('Migration error:', err);
        res.status(500).json({ error: `Migration failed: ${err.message}` });
    }
});

// ═══════════════════════════════════════════
//  WATCH FOLDERS
// ═══════════════════════════════════════════

// GET /api/settings/watches
router.get('/watches', (req, res) => {
    const watches = WatcherService.getAll();
    res.json(watches);
});

// POST /api/settings/watches
router.post('/watches', (req, res) => {
    const { path: folderPath, project_id, auto_import = false } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Path required' });
    if (!fs.existsSync(folderPath)) return res.status(400).json({ error: 'Folder does not exist' });

    try {
        const id = WatcherService.addWatch(folderPath, project_id, auto_import);
        res.status(201).json({ id, path: folderPath });
    } catch (err) {
        res.status(409).json({ error: err.message });
    }
});

// DELETE /api/settings/watches/:id
router.delete('/watches/:id', (req, res) => {
    WatcherService.removeWatch(parseInt(req.params.id));
    res.json({ success: true });
});

// ═══════════════════════════════════════════
//  ACTIVITY LOG
// ═══════════════════════════════════════════

router.get('/activity', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const activity = getRecentActivity(limit);
    res.json(activity);
});

// ═══════════════════════════════════════════
//  FILE BROWSER (for vault setup / folder picking)
// ═══════════════════════════════════════════

router.get('/browse-folders', (req, res) => {
    const { dir } = req.query;

    if (!dir) {
        const drives = FileService.getDrives();
        res.json({ path: '', entries: drives.map(d => ({ name: d, path: d, isDirectory: true })) });
        return;
    }

    try {
        const entries = FileService.browseDirectory(dir)
            .filter(e => e.isDirectory); // Only show folders for path picker
        const parentDir = path.dirname(dir);
        res.json({
            path: dir,
            parent: parentDir !== dir ? parentDir : null,
            entries,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings/rebuild-vault — Re-scan vault files and rebuild database records
router.post('/rebuild-vault', async (req, res) => {
    req.setTimeout(30 * 60 * 1000);
    res.setTimeout(30 * 60 * 1000);

    const vaultRoot = getSetting('vault_root');
    if (!vaultRoot || !fs.existsSync(vaultRoot)) {
        return res.status(400).json({ error: 'Vault root not set or not found' });
    }

    const SKIP_DIRS = new Set(['thumbnails', 'data', '.git', 'node_modules']);
    const db = getDb();

    try {
        // 1. Discover project folders (top-level dirs in vault)
        const topEntries = fs.readdirSync(vaultRoot, { withFileTypes: true });
        const projectDirs = topEntries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name));

        let totalFiles = 0;
        let processed = 0;
        let errors = 0;
        const projectsCreated = [];

        // Pre-count files for progress
        for (const pDir of projectDirs) {
            const pPath = path.join(vaultRoot, pDir.name);
            const countFiles = (dir) => {
                let count = 0;
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
                    else count++;
                }
                return count;
            };
            totalFiles += countFiles(pPath);
        }

        console.log(`[Rebuild] Starting vault rebuild: ${projectDirs.length} projects, ${totalFiles} files`);

        for (const pDir of projectDirs) {
            const projectCode = pDir.name;
            const projectPath = path.join(vaultRoot, projectCode);

            // Create project if not exists
            let project = db.prepare('SELECT * FROM projects WHERE code = ?').get(projectCode);
            if (!project) {
                db.prepare('INSERT INTO projects (name, code, type) VALUES (?, ?, ?)').run(projectCode, projectCode, 'flexible');
                project = db.prepare('SELECT * FROM projects WHERE code = ?').get(projectCode);
            }
            projectsCreated.push({ code: projectCode, id: project.id });

            // Recursively scan project directory for media files
            const scanDir = async (dir, seqCode, shotCode) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                // Process subdirectories first (might be type folders like image/video/threed, or seq/shot folders)
                const subDirs = entries.filter(e => e.isDirectory());
                const files = entries.filter(e => !e.isDirectory());

                for (const sub of subDirs) {
                    await scanDir(path.join(dir, sub.name), seqCode, shotCode);
                }

                // Process files in this directory
                for (const file of files) {
                    const filePath = path.join(dir, file.name);
                    const ext = path.extname(file.name).toLowerCase();
                    const { type: mediaType } = detectMediaType(file.name);
                    if (mediaType === 'document') { processed++; continue; } // Skip non-media

                    try {
                        // Parse naming convention: {CODE}_{type}_{counter}_v{version}.ext
                        // Or: {CODE}_{seq}_{type}_{counter}_v{version}.ext
                        const baseName = path.basename(file.name, ext);
                        const parts = baseName.split('_');
                        let version = 1;
                        let counter = null;

                        // Extract version from last part (v001, v002, etc.)
                        const lastPart = parts[parts.length - 1];
                        if (lastPart && /^v\d+$/i.test(lastPart)) {
                            version = parseInt(lastPart.substring(1));
                        }

                        // Extract counter (the numeric part before version)
                        for (let i = parts.length - 2; i >= 0; i--) {
                            if (/^\d{3,}$/.test(parts[i])) {
                                counter = parseInt(parts[i]);
                                break;
                            }
                        }

                        const relativePath = path.relative(vaultRoot, filePath);

                        // Check if asset already exists (by file_path or vault_name)
                        const existing = db.prepare('SELECT id FROM assets WHERE file_path = ? OR vault_name = ?').get(filePath, file.name);
                        if (existing) { processed++; continue; }

                        // Probe metadata
                        const info = await MediaInfoService.probe(filePath);

                        // Insert asset
                        const result = db.prepare(`
                            INSERT INTO assets (
                                project_id, sequence_id, shot_id,
                                original_name, vault_name, file_path, relative_path,
                                media_type, file_ext, file_size,
                                width, height, duration, fps, codec,
                                take_number, version
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            project.id, null, null,
                            file.name, file.name, filePath, relativePath,
                            mediaType, ext,
                            info.fileSize || 0,
                            info.width, info.height, info.duration, info.fps, info.codec,
                            counter || (processed + 1),
                            version
                        );

                        const assetId = result.lastInsertRowid;

                        // Generate thumbnail
                        try {
                            const thumbPath = await ThumbnailService.generate(filePath, assetId);
                            if (thumbPath) {
                                db.prepare('UPDATE assets SET thumbnail_path = ? WHERE id = ?').run(thumbPath, assetId);
                            }
                        } catch (thumbErr) {
                            // Non-fatal: just skip thumbnail
                        }

                        processed++;
                        if (processed % 50 === 0) {
                            console.log(`[Rebuild] Progress: ${processed}/${totalFiles}`);
                        }
                    } catch (fileErr) {
                        console.error(`[Rebuild] Error processing ${file.name}: ${fileErr.message}`);
                        errors++;
                        processed++;
                    }
                }
            };

            await scanDir(projectPath, null, null);
        }

        const assetCount = db.prepare('SELECT COUNT(*) as cnt FROM assets').get().cnt;
        console.log(`[Rebuild] Complete: ${assetCount} assets in database, ${errors} errors`);

        res.json({
            success: true,
            projects: projectsCreated,
            totalFiles,
            processed,
            errors,
            assetsInDb: assetCount,
        });
    } catch (err) {
        console.error(`[Rebuild] Fatal error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
//  mrViewer2 HOTKEYS — Read/Write mrv2.keys.prefs
// ═══════════════════════════════════════════

const MRV2_KEYS_PATH = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.filmaura',
    'mrv2.keys.prefs'
);

/** Category mapping for ~200 mrv2 actions → UI sections */
const HOTKEY_CATEGORIES = {
    'View': [
        'Exposure More', 'Exposure Less', 'Gamma More', 'Gamma Less',
        'Saturation More', 'Saturation Less', 'Reset Gain/Gamma',
        'Zoom Minimum', 'Zoom Maximum', 'Center Image', 'Fit Screen',
        'Fit All', 'Resize Main Window to Fit', 'Auto Frame View',
        'Toggle Full Screen', 'Toggle Presentation', 'Safe Areas',
        'Color Channel', 'Red Channel', 'Green Channel', 'Blue Channel',
        'Alpha Channel', 'Toggle Minify Texture Filtering',
        'Toggle Magnify Texture Filtering',
    ],
    'Playback': [
        'Play Forwards', 'Play Backwards', 'Stop', 'Toggle Playback',
        'Frame Step Forward', 'Frame Step Backwards',
        'Play Direction Forward', 'Play Direction Backwards',
        'Playback Loop', 'Playback Once', 'Playback Ping-Pong',
        'First Frame', 'Last Frame', 'First Image Version', 'Last Image Version',
        'Previous Image', 'Next Image', 'Previous Image Version', 'Next Image Version',
        'Previous Channel', 'Next Channel', 'Previous Layer', 'Next Layer',
        'Previous Clip', 'Next Clip',
        'Set In Point', 'Set Out Point', 'Clear In/Out Point',
    ],
    'File': [
        'Open Directory', 'Open Movie or Sequence', 'Open Single Image',
        'Open Session', 'Open New Program Instance',
        'Save Image', 'Save Audio', 'Save Frames To Folder',
        'Save Movie or Sequence', 'Save Session', 'Save Session As',
        'Close Current', 'Close All', 'Reload Session', 'Quit Program',
    ],
    'OCIO / Color': [
        'OCIO Presets', 'OCIO In Top Bar', 'OCIO Input Color Space',
        'OCIO Display', 'OCIO View', 'OCIO Toggle',
        'HDR Data From File', 'HDR Data Inactive', 'HDR Data Active',
        'Toggle HDR tonemap', 'Auto Normalize', 'Invalid Values',
        'Ignore Display Window', 'Ignore Chromaticities',
    ],
    'Panels': [
        'Toggle Menu Bar', 'Toggle Top Bar', 'Toggle Pixel Bar',
        'Toggle Timeline', 'Toggle Status Bar', 'Toggle Tool Dock',
        'Toggle Float On Top', 'Toggle Secondary',
        'Hud Window', 'Toggle One Panel Only',
        'Toggle Files Panel', 'Toggle Media Info Panel',
        'Toggle Color Area Info Panel', 'Toggle Color Controls Panel',
        'Toggle Playlist Panel', 'Toggle Compare Panel',
        'Toggle Annotation Panel', 'Toggle Settings Panel',
        'Toggle Histogram Panel', 'Toggle Vectorscope Panel',
        'Toggle Waveform Panel', 'Toggle Preferences Window',
        'Toggle Hotkeys Window', 'Toggle Log Panel',
        'Toggle Python Panel', 'Toggle About Window',
        'Toggle NDI', 'Toggle Network', 'Toggle USD', 'Toggle Stereo 3D',
    ],
    'Annotation': [
        'Scrub Mode', 'Area Selection Mode', 'Draw Mode', 'Erase Mode',
        'Polygon Mode', 'Arrow Mode', 'Rectangle Mode', 'Circle Mode',
        'Text Mode', 'Voice Mode', 'File/URL Link Mode',
        'Pen Size More', 'Pen Size Less', 'Undo Draw', 'Redo Draw',
        'Switch Pen Color',
    ],
    'Compare': [
        'Compare None', 'Compare Wipe', 'Compare Overlay',
        'Compare Difference', 'Compare Horizontal', 'Compare Vertical',
        'Compare Tile',
    ],
};

/** Parse mrv2.keys.prefs → array of { name, ctrl, alt, meta, shift, key, text } */
function parseMrv2Keys() {
    if (!fs.existsSync(MRV2_KEYS_PATH)) return null;
    const raw = fs.readFileSync(MRV2_KEYS_PATH, 'utf-8');
    const lines = raw.split(/\r?\n/);

    const actions = [];
    const fields = ['ctrl', 'alt', 'meta', 'shift', 'key', 'text'];
    let current = null;

    for (const line of lines) {
        if (line.startsWith(';') || line.startsWith('[') || !line.includes(':')) continue;
        if (line.startsWith('version:')) continue;

        // Format: "Action Name field:value"
        // e.g. "Exposure More ctrl:0"
        for (const field of fields) {
            const suffix = ` ${field}:`;
            const idx = line.lastIndexOf(suffix);
            if (idx === -1) continue;
            const actionName = line.substring(0, idx);
            const value = line.substring(idx + suffix.length);

            if (field === 'ctrl') {
                // Start a new action
                current = { name: actionName };
                actions.push(current);
            }
            if (current && current.name === actionName) {
                current[field] = value;
            }
            break;
        }
    }
    return actions;
}

/** Key code → readable label (FLTK key codes) */
const FLTK_KEY_NAMES = {
    0: '', 8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: 'Space',
    44: ',', 45: '-', 46: '.', 47: '/',
    48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
    59: ';', 61: '=', 91: '[', 92: '\\', 93: ']', 96: '`',
    97: 'A', 98: 'B', 99: 'C', 100: 'D', 101: 'E', 102: 'F',
    103: 'G', 104: 'H', 105: 'I', 106: 'J', 107: 'K', 108: 'L',
    109: 'M', 110: 'N', 111: 'O', 112: 'P', 113: 'Q', 114: 'R',
    115: 'S', 116: 'T', 117: 'U', 118: 'V', 119: 'W', 120: 'X',
    121: 'Y', 122: 'Z',
    127: 'Delete',
    65288: 'Backspace', 65289: 'Tab', 65293: 'Enter', 65307: 'Escape',
    65360: 'Home', 65361: 'Left', 65362: 'Up', 65363: 'Right', 65364: 'Down',
    65365: 'Page Up', 65366: 'Page Down', 65367: 'End',
    65379: 'Insert', 65535: 'Delete',
    65470: 'F1', 65471: 'F2', 65472: 'F3', 65473: 'F4', 65474: 'F5', 65475: 'F6',
    65476: 'F7', 65477: 'F8', 65478: 'F9', 65479: 'F10', 65480: 'F11', 65481: 'F12',
};

function keyCodeToLabel(keyCode, textVal) {
    const kc = parseInt(keyCode) || 0;
    if (kc > 0 && FLTK_KEY_NAMES[kc]) return FLTK_KEY_NAMES[kc];
    if (kc >= 97 && kc <= 122) return String.fromCharCode(kc).toUpperCase();
    if (kc >= 48 && kc <= 57) return String.fromCharCode(kc);
    if (kc > 0) return `Key(${kc})`;
    if (textVal) return textVal;
    return '';
}

/** Build human-readable shortcut string */
function buildShortcutLabel(action) {
    const parts = [];
    if (action.ctrl === '1') parts.push('Ctrl');
    if (action.alt === '1') parts.push('Alt');
    if (action.shift === '1') parts.push('Shift');
    if (action.meta === '1') parts.push('Meta');
    const keyLabel = keyCodeToLabel(action.key, action.text);
    if (keyLabel) parts.push(keyLabel);
    return parts.join(' + ') || '(none)';
}

// GET /api/settings/hotkeys — Read all mrv2 keyboard shortcuts
router.get('/hotkeys', (req, res) => {
    const actions = parseMrv2Keys();
    if (!actions) {
        return res.status(404).json({ error: 'mrv2.keys.prefs not found', path: MRV2_KEYS_PATH });
    }

    // Build categorized result + any uncategorized actions
    const categorized = Object.keys(HOTKEY_CATEGORIES).map(cat => {
        const nameSet = new Set(HOTKEY_CATEGORIES[cat]);
        return { name: cat, actions: [] };
    });

    const catNameSets = {};
    for (const cat of Object.keys(HOTKEY_CATEGORIES)) {
        catNameSets[cat] = new Set(HOTKEY_CATEGORIES[cat]);
    }

    const assigned = new Set();
    for (const action of actions) {
        let placed = false;
        for (let i = 0; i < categorized.length; i++) {
            const catName = categorized[i].name;
            if (catNameSets[catName].has(action.name)) {
                categorized[i].actions.push({
                    ...action,
                    label: buildShortcutLabel(action),
                });
                assigned.add(action.name);
                placed = true;
                break;
            }
        }
    }

    // Collect remaining into "Other"
    const other = actions
        .filter(a => !assigned.has(a.name))
        .map(a => ({ ...a, label: buildShortcutLabel(a) }));

    if (other.length > 0) {
        categorized.push({ name: 'Other', actions: other });
    }

    res.json({ categories: categorized, path: MRV2_KEYS_PATH });
});

// POST /api/settings/hotkeys — Save changed hotkeys back to mrv2.keys.prefs
router.post('/hotkeys', (req, res) => {
    const { changes } = req.body;
    // changes = [{ name:'Exposure More', ctrl:'0', alt:'0', meta:'0', shift:'0', key:'101', text:'' }, ...]
    if (!changes || !Array.isArray(changes)) {
        return res.status(400).json({ error: 'changes array required' });
    }

    if (!fs.existsSync(MRV2_KEYS_PATH)) {
        return res.status(404).json({ error: 'mrv2.keys.prefs not found' });
    }

    let raw = fs.readFileSync(MRV2_KEYS_PATH, 'utf-8');

    for (const change of changes) {
        const fields = ['ctrl', 'alt', 'meta', 'shift', 'key', 'text'];
        for (const field of fields) {
            if (change[field] === undefined) continue;
            const pattern = `${change.name} ${field}:`;
            // Replace the line
            const regex = new RegExp(`^${escapeRegex(pattern)}.*$`, 'm');
            raw = raw.replace(regex, `${pattern}${change[field]}`);
        }
    }

    // Backup original
    const backupPath = MRV2_KEYS_PATH + '.bak';
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(MRV2_KEYS_PATH, backupPath);
    }

    fs.writeFileSync(MRV2_KEYS_PATH, raw, 'utf-8');
    res.json({ success: true, written: changes.length });
});

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

module.exports = router;
