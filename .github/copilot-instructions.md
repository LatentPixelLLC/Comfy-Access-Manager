# Digital Media Vault (DMV) — AI Coding Instructions

## 🎯 Project Overview

**Digital Media Vault (DMV)** is a local media asset manager for creative production — organize, browse, import, export, and play media files with a project-based hierarchy following ShotGrid/Flow Production Tracking naming conventions.

**Version**: 1.0.0  
**Location**: `C:\MediaVault`  
**Port**: 7700  
**Status**: Active development (February 2026)

Built for artists and studios who work with video, images, EXR sequences, 3D files, and audio, and want a fast way to manage them without cloud services.

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Vanilla JavaScript ES6 modules, HTML, CSS (no build step)
- **Backend**: Node.js + Express (server.js)
- **Database**: sql.js v1.11.0 (WASM SQLite — no native compilation)
- **Thumbnails**: Sharp (images), FFmpeg (video)
- **Transcode/Export**: FFmpeg with NVENC GPU acceleration
- **File Watching**: Chokidar
- **ComfyUI**: Custom Python nodes + JS dynamic dropdown extension
- **GPU**: NVIDIA RTX PRO 6000 Blackwell (for NVENC and VisionService)

### File Structure
```
MediaVault/
├── src/
│   ├── server.js              # Express server (95 lines, port 7700)
│   ├── database.js            # sql.js wrapper with better-sqlite3–compatible API (419 lines)
│   ├── routes/
│   │   ├── projectRoutes.js   # Project + Sequence + Shot CRUD (~324 lines)
│   │   ├── assetRoutes.js     # Asset import, browse, streaming, delete (~1125 lines)
│   │   ├── exportRoutes.js    # FFmpeg transcode/export
│   │   ├── roleRoutes.js      # Role CRUD
│   │   ├── settingsRoutes.js  # Settings API + vault setup
│   │   ├── comfyuiRoutes.js   # ComfyUI integration endpoints (266 lines)
│   │   └── flowRoutes.js      # Flow/ShotGrid sync (pinned feature)
│   ├── services/
│   │   ├── ThumbnailService.js  # Thumbnail generation (Sharp + FFmpeg)
│   │   ├── MediaInfoService.js  # Metadata extraction (FFprobe)
│   │   ├── FileService.js       # File operations
│   │   ├── WatcherService.js    # Folder watching (Chokidar)
│   │   └── FlowService.js      # Flow/ShotGrid API client
│   └── utils/
│       ├── naming.js          # ShotGrid naming engine (245 lines)
│       └── mediaTypes.js      # File ext → media type mapping
├── public/
│   ├── index.html             # Single-page app shell (442 lines)
│   ├── css/styles.css         # Neutral gray theme for VFX work (1696+ lines)
│   └── js/                    # Frontend ES6 modules
│       ├── main.js            # Entry point, tab switching (100 lines)
│       ├── browser.js         # Asset browser, grid/list, tree nav (1330 lines)
│       ├── import.js          # File browser, import flow (392 lines)
│       ├── export.js          # Export modal (352 lines)
│       ├── player.js          # Media player modal
│       ├── settings.js        # Settings tab
│       ├── api.js             # API client helper
│       ├── state.js           # Global state singleton
│       └── utils.js           # Shared utilities (esc, formatSize, showToast)
├── comfyui/
│   ├── __init__.py            # ComfyUI node package init
│   ├── mediavault_node.py     # 3 custom nodes (692 lines)
│   └── js/
│       └── mediavault_dynamic.js  # Dynamic cascading dropdowns (192 lines)
├── data/
│   └── mediavault.db          # SQLite database (auto-created)
├── thumbnails/                # Generated thumbnails
├── scripts/                   # Migration scripts
├── package.json
├── start.bat / start.sh
└── install.bat / install.sh
```

---

## 📊 Database Schema

The database uses sql.js (WASM SQLite). All queries go through `database.js` which wraps the raw sql.js API to be compatible with better-sqlite3's `.prepare().run/get/all()` pattern.

### Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | Top-level containers | id, name, code, type, flow_id |
| `sequences` | Groups shots within a project | id, project_id, name, code, flow_id |
| `shots` | Individual shots within sequences | id, sequence_id, **project_id**, name, code, flow_id |
| `assets` | Media files (the core table) | id, project_id, sequence_id, shot_id, role_id, original_name, vault_name, file_path, relative_path, media_type, is_linked, ... |
| `roles` | Pipeline steps (Comp, Light, Anim...) | id, name, code, color, icon, flow_id |
| `settings` | Key-value configuration | key, value |
| `watch_folders` | Monitored directories | id, path, project_id |
| `comfyui_mappings` | ComfyUI node→asset persistence | workflow_id, node_id, asset_id |
| `activity_log` | Action audit trail | action, entity_type, entity_id, details |

### ⚠️ CRITICAL: Shot Table Has BOTH sequence_id AND project_id

The `shots` table has both `sequence_id` and `project_id`. This is intentional because the shots query in `projectRoutes.js` filters on **both** columns:

```sql
SELECT * FROM shots WHERE sequence_id = ? AND project_id = ?
```

**If you migrate/restructure the hierarchy, you MUST update `project_id` on shots too!** Otherwise the shot dropdown in the Import tab will be empty. This was a real bug (January 2026).

### Default Roles (seeded on first run)
Comp, Light, Anim, FX, Enviro, Layout, Matchmove, Roto

---

## 🏷️ ShotGrid Naming Convention

All imported files follow ShotGrid/Flow Production Tracking naming standards.

### Templates (naming.js)

The folder path encodes the full hierarchy (Project/Sequence/Shot/), so filenames only
need the most-specific identifier + step + version:

| Context | Template | Example |
|---------|----------|--------|
| Shot + Role | `{shot}_{step}_v{version}` | `EDA1500_comp_v001.exr` |
| Sequence + Role | `{sequence}_{step}_v{version}` | `EDA_plate_v003.dpx` |
| Project + Role | `{project}_{step}_v{version}` | `AP1_edit_v001.mov` |
| Legacy (no role) | `{shot}_{take}_{counter}` | `EDA1500_T01_0001.mov` |

### Available Tokens

| Token | Description | Example |
|-------|-------------|---------|
| `{project}` | Project code | `AP1` |
| `{sequence}` | Sequence code | `EDA` |
| `{shot}` | Shot code | `EDA1500` |
| `{step}` | Role/pipeline step (lowercase) | `comp` |
| `{version}` | 3-digit zero-padded version | `001` |
| `{take}` | Take number | `T01` |
| `{type}` | Media type | `video` |
| `{date}` | Date YYYYMMDD | `20260211` |
| `{original}` | Original filename | `render_v5` |
| `{counter}` | Auto-increment counter | `0001` |

### ⚠️ CRITICAL: generateVaultName() Returns an Object

```javascript
const naming = require('./utils/naming');

// ❌ WRONG — returns { vaultName, ext } object, not a string!
const vaultName = naming.generateVaultName({ ... });

// ✅ CORRECT — destructure the result
const nameResult = naming.generateVaultName({ ... });
const vaultName = nameResult.vaultName;  // "AP1_EDA_EDA1500_comp_v001.exr"
const ext = nameResult.ext;              // ".exr"
```

This was a real bug that caused `[object Object]` in the database (February 2026).

---

## 📥 Import Modes

The import system supports three modes:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Move** (default) | Files are moved into the vault folder structure. Originals are removed. | Normal workflow |
| **Copy** | Files are copied into the vault. Originals stay at source. | When you need to keep originals |
| **Register in Place** | Files stay where they are. Only a DB reference is created. `is_linked = 1` | Network drives, large files |

### Register-in-Place Key Details
- Sets `is_linked = 1` in the assets table
- `file_path` stores the original absolute path (not a vault path)
- `vault_name` still gets the ShotGrid-standard name (for display/search)
- Protected from deletion — bulk delete warns if asset is linked
- Must call `generateVaultName()` and destructure properly

---

## 🎨 ComfyUI Integration

### Architecture
```
ComfyUI (Python + LiteGraph)
    ↓ junction link: custom_nodes\mediavault → C:\MediaVault\comfyui
    ↓
├── mediavault_node.py (3 nodes)
│   ├── LoadFromMediaVault — Load image from vault by hierarchy selection
│   ├── LoadVideoFrameFromMediaVault — Load video frame by frame number
│   └── SaveToMediaVault — Save ComfyUI output back to vault
│
├── js/mediavault_dynamic.js (frontend extension, 258 lines)
│   ├── Cascading dropdowns: Project → Sequence → Shot → Role → Asset
│   ├── prefillFromLoadNode(saveNode) — auto-copies Project/Seq/Shot from Load node
│   ├── "📂 Copy from Load Node" button on Save nodes
│   ├── 🔄 Refresh button — re-queries projects, roles, and all dropdowns
│   └── mvFetch() calls proxy routes on ComfyUI's PromptServer
│
└── Proxy Routes (registered in mediavault_node.py via PromptServer)
    ├── /mediavault/projects
    ├── /mediavault/sequences?project_id=X
    ├── /mediavault/shots?project_id=X&sequence_id=Y
    ├── /mediavault/roles
    └── /mediavault/assets?project_id=X&...
```

### ⚠️ CRITICAL: INPUT_TYPES Runs Once at Startup

The Python `INPUT_TYPES` classmethod is called **once** when ComfyUI registers the node class. This means:
- Project/sequence/shot lists are **baked in** at startup
- New projects added to MediaVault won't appear until ComfyUI restarts
- **WORKAROUND**: The 🔄 Refresh button in `mediavault_dynamic.js` now updates **projects and roles** via live API calls without restarting ComfyUI

### ComfyUI File Locations
- **Python path**: `C:\ComfyUI_windows_portable\python_embeded\python.exe`
- **ComfyUI root**: `C:\ComfyUI_windows_portable\ComfyUI`
- **Junction link**: `mklink /J ComfyUI\custom_nodes\mediavault C:\MediaVault\comfyui`

### 3-Tier Asset Resolution (mediavault_node.py)
When loading an asset, the node tries:
1. **ComfyUI mapping** — persistent per-node memory (`comfyui_mappings` table)
2. **Exact vault_name match** — search by filename
3. **Fuzzy match** — partial filename search across the project

### Save Node Auto-Populate from Load Node

When a **SaveToMediaVault** node is added to the graph, `mediavault_dynamic.js` automatically scans `app.graph._nodes` for any existing Load node (`LoadFromMediaVault`, `LoadVideoFrameFromMediaVault`, `LoadVideoFromMediaVault`). If one is found with a real project selected, it copies the Project, Sequence, and Shot values to the Save node so you don't set them twice.

- **Auto on creation**: `setTimeout(() => prefillFromLoadNode(node), 500)` runs after the graph settles
- **Manual button**: "📂 Copy from Load Node" lets you re-sync at any time
- `LOAD_NODE_TYPES` array lists all recognized Load node class names
- Uses `cascadeUpdate()` to trigger the dropdown chain, then re-applies sequence/shot after the cascade resets them

---

## 🎬 Export System

- GPU-accelerated: H.264 NVENC, H.265/HEVC NVENC
- CPU fallbacks: libx264, libx265
- ProRes: 422 HQ, 422 LT, 422 Proxy
- Resolution presets: Original, 4K, 1440p, 1080p, 720p, 540p, 480p
- Copy mode (no re-encode) for container changes
- Exported files auto-register back into the vault

---

## 🔌 API Endpoints

### Projects
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create project |
| `/api/projects/:id` | GET | Get project with stats |
| `/api/projects/:id` | DELETE | Delete project + assets |
| `/api/projects/:id/sequences` | GET | List sequences |
| `/api/projects/:id/sequences` | POST | Create sequence |
| `/api/projects/:projectId/sequences/:seqId/shots` | GET | List shots (filters on **both** seq + project) |
| `/api/projects/:projectId/sequences/:seqId/shots` | POST | Create shot |

### Assets
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/assets` | GET | List/filter assets |
| `/api/assets/import` | POST | Import files (move/copy/register) |
| `/api/assets/browse` | GET | Browse filesystem |
| `/api/assets/:id` | GET | Get single asset |
| `/api/assets/:id` | DELETE | Delete asset |
| `/api/assets/bulk-delete` | POST | Bulk delete |
| `/api/assets/:id/stream` | GET | Stream media file |
| `/api/assets/:id/thumbnail` | GET | Get thumbnail |

### Roles
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/roles` | GET | List all roles |
| `/api/roles` | POST | Create role |
| `/api/roles/:id` | PUT | Update role |
| `/api/roles/:id` | DELETE | Delete role |

### Settings
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Get all settings |
| `/api/settings` | POST | Save settings |
| `/api/settings/status` | GET | System status (vault configured, asset count) |
| `/api/settings/setup-vault` | POST | First-time vault setup |

### ComfyUI
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/comfyui/projects` | GET | Projects for dropdown |
| `/api/comfyui/sequences` | GET | Sequences (filterable) |
| `/api/comfyui/shots` | GET | Shots (filterable) |
| `/api/comfyui/roles` | GET | All roles |
| `/api/comfyui/assets` | GET | Assets (filterable by hierarchy) |
| `/api/comfyui/save` | POST | Save ComfyUI output to vault |

### Export
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/export/presets` | GET | Available codecs + resolutions |
| `/api/export/probe/:id` | GET | FFprobe asset info |
| `/api/export` | POST | Start export job |

---

## 🖥️ Frontend Architecture

### Module Structure
All frontend code uses ES6 modules loaded from `/js/main.js`:

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `main.js` | Entry point, tab switching, vault setup | `switchTab()` |
| `state.js` | Global state singleton | `state` object |
| `api.js` | Fetch wrapper with error handling | `api(url, opts)` |
| `browser.js` | Projects grid, tree nav, asset grid/list, selection, drag-drop | `loadProjects()`, `loadTree()` |
| `import.js` | File browser, import flow, rename preview | `loadImportTab()` |
| `export.js` | Export modal with codec/resolution selection | `showExportModal()` |
| `player.js` | Built-in media player modal | `openPlayer()` |
| `settings.js` | Settings tab, roles, hotkeys | `loadSettings()`, `loadRoles()` |
| `utils.js` | Shared utilities | `esc()`, `formatSize()`, `showToast()` |

### Tab System
4 tabs controlled by `data-tab` attributes:
- **Projects** — Project cards grid
- **Browser** — Tree + asset grid/list with filter bar and selection toolbar
- **Import** — File browser + import settings with ShotGrid naming preview
- **Settings** — Vault config, naming, player, ComfyUI, Flow, roles, watch folders, hotkeys

### CSS Theme
Neutral gray theme designed for VFX / color-critical work:
- No saturated accent colors that could bias color perception
- Variables: `--bg-dark: #1a1a1a`, `--bg-card: #222222`, `--accent: #888888`
- Media type colors: video (#88aacc), image (#88aa88), audio (#aa88aa), EXR (#bb9966)

### Tooltip System (February 2026)
Two approaches available:
1. **`title=""` attribute** — Native browser tooltip, simple hover
2. **`.has-tip` class + `data-tip`** — Custom styled CSS tooltip (positioned above, max 280px)
3. **`.help-icon`** — Small "?" circle next to labels with hover tooltip

```html
<!-- Simple native tooltip -->
<button title="Click to refresh the asset list">🔄</button>

<!-- Custom styled tooltip -->
<span class="has-tip" data-tip="Detailed explanation here">Label</span>

<!-- Help icon next to a label -->
<label>Role <span class="help-icon" data-tip="Pipeline step (Comp, Light, Anim). Drives the {step} token.">?</span></label>
```

---

## 📁 Global State (state.js)

```javascript
export const state = {
    currentTab: 'projects',
    currentProject: null,
    currentSequence: null,
    currentShot: null,
    currentRole: null,       // { id, name, code, color, icon }
    projects: [],
    assets: [],
    roles: [],
    viewMode: 'grid',         // 'grid' or 'list'
    
    // Import
    importBrowsePath: '',
    selectedFiles: [],        // { name, path, size, mediaType, icon }
    browsedFiles: [],
    lastClickedIndex: -1,
    
    // Player
    playerAssets: [],
    playerIndex: 0,
    
    // Selection (bulk operations)
    selectedAssets: [],       // Array of asset IDs
    lastClickedAsset: -1,
    
    settings: {},
    vaultConfigured: false,
};
```

---

## 🐛 Known Issues & Lessons Learned

### Register-in-Place Import (4 bugs fixed February 2026)
1. `imported` variable was undefined in register-in-place branch (only defined in move/copy)
2. Register-in-place wasn't calling `generateVaultName()` — used raw `originalName`
3. `generateVaultName()` returns `{ vaultName, ext }` but was assigned directly to a string variable
4. Thumbnail generation and activity logging referenced wrong variable (`imported.vaultPath` vs local `vaultPath`)

### Shot Dropdown Empty After DB Migration
When restructuring the hierarchy (moving shots between projects), you must update `project_id` on the shots table. The API filters on `WHERE sequence_id = ? AND project_id = ?`.

### ComfyUI Projects Not Appearing
`INPUT_TYPES` classmethod runs once at node registration. New projects require a ComfyUI restart or the 🔄 Refresh button (which now fetches projects too).

---

## ⚠️ Important Rules for AI Agents

1. **Port is 7700** — `http://localhost:7700`
2. **Database is sql.js (WASM)** — NOT better-sqlite3. The wrapper in database.js provides compatibility, but the raw API is different.
3. **`generateVaultName()` returns `{ vaultName, ext }`** — Always destructure! Never assign directly to a string.
4. **Shots have both `sequence_id` AND `project_id`** — Update both when migrating.
5. **Frontend is plain ES6 modules** — No React, no build step, no JSX. Use `document.createElement()` or template literals.
6. **All onclick handlers must be on `window`** — ES6 modules scope functions; expose via `window.functionName = functionName`.
7. **Database auto-saves on every write** — `_save()` is called after each prepared statement `.run()`. Batch operations should use `wrapper.transaction()`.
8. **ComfyUI junction link** — `custom_nodes\mediavault` → `C:\MediaVault\comfyui`. Don't break this symlink.
9. **Neutral gray theme** — No saturated accent colors. This is for VFX color-critical work.
10. **FFmpeg is required** — For thumbnails, transcoding, streaming, and export.
11. **`is_linked = 1` means register-in-place** — These assets can't be safely deleted from disk. Warn the user.
12. **Settings are key-value pairs in the `settings` table** — Use `getSetting(key)` / `setSetting(key, value)`.
13. **Activity log** — Use `logActivity(action, entityType, entityId, details)` for audit trail.
14. **Always test with the server running** — `node src/server.js` from the MediaVault directory.

---

## 📌 Pinned Future Features

### 🔀 Flow/ShotGrid API Integration
**Status**: Pinned — awaiting credentials  
**Goal**: Sync project structure from Autodesk Flow (ShotGrid)  
**Files**: `src/routes/flowRoutes.js`, `src/services/FlowService.js`  
Already has UI in Settings tab (Site URL, Script Name, API Key fields + Test/Sync buttons).

### 🤖 VisionService Camera Integration
**Status**: Separate project at `C:\VisionService` (port 5100)  
**Goal**: AI object detection (YOLO) on camera feeds  
Potential future link: auto-import detected clips into DMV.

### 📋 Review Mode — FFmpeg Burn-In Overlays for mrViewer2
**Status**: Pinned — blocked by FFmpeg drawtext bug  
**Goal**: Open assets in mrv2 with burned-in review overlays (project hierarchy, frame counter, resolution, watermark, safe areas)  
**Commit so far**: `bb8f8e8` — endpoint, UI button, context menu all working. Font fix + error logging uncommitted in `assetRoutes.js`.

**What's done:**
- `POST /api/assets/:id/open-review` endpoint in `assetRoutes.js` (generates temp file with overlays, opens in mrv2)
- `buildReviewFilters(opts)` function generates FFmpeg `-vf` drawtext/drawbox chain
- `findFontFile()` helper resolves platform font paths for FFmpeg
- "📋 Review" button in player toolbar + right-click context menu in browser
- `openReviewInMrv2(assetId)` in `player.js` with overlay preference support

**The Bug:**
FFmpeg's drawtext filter fails when chaining 3+ filters that use expressions (`y=ih-26`, `x=w-text_w-10`). Error: `Failed to configure input pad on Parsed_drawtext_N`. Static numeric x/y values work fine; expressions break it. Same result with `-vf` and `-filter_complex`. Tested extensively — it's an FFmpeg filtergraph issue, not escaping.

**Fix approaches when resuming:**
1. **Pre-calculate expressions** — ffprobe the video dimensions first, compute `ih-26` as actual pixels, use static values
2. **`-filter_script`** — write filters to a temp `.txt` file (may bypass parser)
3. **Two-pass** — render in 2 FFmpeg calls (2 drawtext max per pass)

**Cleanup needed:** Delete `test_ffmpeg_filter.js` and `test_arial.ttf` from project root.

---

## 🧪 Development Commands

```bash
# Start server (port 7700)
cd C:\MediaVault
node src/server.js

# Or use launcher
start.bat       # Windows
./start.sh      # Mac/Linux

# Dev mode with auto-restart
npm run dev

# Install dependencies
npm install
```

### Common Issues
- **Port 7700 in use**: `start.bat` auto-clears it. Manual: `Get-NetTCPConnection -LocalPort 7700 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- **Database locked**: Only one server process can access the DB. Kill other node processes.
- **ComfyUI node not loading**: Check junction link exists: `dir ComfyUI\custom_nodes\mediavault`
- **Thumbnails not generating**: Verify FFmpeg is on PATH: `ffmpeg -version`

---

## 🔄 Git Workflow

```bash
# Development on main
git add -A
git commit -m "feat: Description"
git push origin main

# Deploy to stable
git push origin main:stable
```

### Commit Prefixes
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `refactor:` — Code restructure
- `chore:` — Maintenance

---

*Built for VFX artists who need fast, local media management without cloud services.* 🗄️
