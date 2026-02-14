# Changelog

All notable changes to Comfy Asset Manager (CAM) will be documented in this file.

## [1.1.0] - 2026-02-14

### Changed
- **Rebranded to Comfy Asset Manager (CAM)** — UI header, page titles, setup overlay, and popout player now show "CAM" branding

### Added
- **RV / OpenRV integration** — professional media review tool as the default external player
  - A/B wipe comparison: select 2 assets → "Compare in RV" for side-by-side
  - Persistent RV sessions via rvpush — send assets to a running RV instance
  - MediaVault RV plugin with Compare To submenu, role-based version switching, Prev/Next Version navigation
  - Qt AssetPickerDialog — full tree/table picker replaces monolithic context menus
  - Hierarchical fallback: Compare/Switch searches shot → sequence → project for related assets
  - Bundled OpenRV auto-download in install.bat
  - macOS OpenRV build guide
- **Inline Sequence/Shot creation in Import** — "+" buttons next to Sequence and Shot dropdowns let you create new sequences/shots without leaving the Import tab
  - Auto-suggested codes (SQ010, SH010)
  - Auto-create on import: pending inline forms are created automatically when you click Import
- **Custom video transport** — real-time scrubbing, frame stepping (arrow keys), J/K/L shuttle control
- **Frame cache engine** — RV-style sequential decode + cached playback for instant scrubbing
  - WebCodecs frame cache via VideoDecoder + mp4box.js for 100% frame-accurate decode
  - Multi-clip cache pool with adjacent clip pre-caching
- **Pop-out player** — open media in a separate window with presentation mode
- **Play All** — play all assets in current view as a playlist
- **ComfyUI generation metadata capture** — Tab-key side panel in player shows ComfyUI workflow info
- **Keep original filenames** option in import settings
- **App version display** in top bar with update notification system (T2-style banner + modal)
- **Move-mode confirmation gate** — warning dialog before moving files (prevents accidental data loss)
- **Right-click context menus** for shots, sequences, and projects in Browser tree
- **Mac/Linux support** — .command wrappers for double-click launch, auto-install via Homebrew, execute permissions
- **Network drive browsing** — mounted volumes and network drives visible in Import file browser (Mac/Linux)
- **Copyright headers** on all source files + frontend JS obfuscation build step
- **Proprietary LICENSE** file

### Fixed
- **Inline shot creation silently failing** — "+" button no longer toggles (always opens form), Cancel button closes it; import auto-creates pending forms
- **RV -wipe flag treated as filename** — moved flag before file paths in command args
- **RV session management** — don't kill RV for compare, push files to running instance
- **WebCodecs mp4box async race condition** — rewritten decoder pipeline
- **Frame stepping skips** — fixed gap-fill duplicates causing stutter
- **Canvas hidden by CSS** — use visibility:hidden instead of display:none for cached video
- **ComfyUI save timeout** — increased to 120s for large video files (was 3s)
- **Mac/Linux launcher permissions** — .sh and .command files now have execute permission
- **Line endings** — forced LF on all .sh/.command files for macOS compatibility

### Removed
- **mrViewer2** — fully removed in favor of RV/OpenRV as the sole external player
- **Web UI compare features** — RV handles compare natively via its plugin

## [1.0.0] - 2026-02-12

### Added
- **ComfyUI thumbnail preview** on Load nodes — shows 320px JPEG thumbnail of selected asset directly in the node graph
- **ShotGrid-style list view** in Browser tab — 11-column table with sticky header, role color tags, audio/media indicators
- **Version-aware collision handler** — `resolveCollision()` increments version (v002→v003) instead of appending `_02` suffixes
- **Register-in-Place import mode** — files stay at original location, only a database reference is created (`is_linked = 1`)
- **Three import modes**: Move, Copy, Register in Place
- **ShotGrid naming convention** — auto-rename files following industry-standard patterns (`{shot}_{step}_v{version}`)
- **ComfyUI integration** — 3 custom nodes (Load, LoadVideo, Save) with cascading dropdown filters and proxy routes
- **Export system** — FFmpeg transcode with NVENC GPU acceleration, ProRes, resolution presets
- **Built-in media player** — images, video, audio with on-the-fly transcoding for pro codecs
- **Tree navigation** — left panel with Project → Sequence → Shot → Role hierarchy
- **Drag-and-drop import** — drop files onto browser for quick import
- **Thumbnail generation** — Sharp (images) + FFmpeg (video frame grab at ~1s)
- **Role management** — customizable pipeline steps with colors and icons

### Fixed
- **Version detection basePattern mismatch** — `FileService.importFile()` now matches actual ShotGrid template output, preventing `v002_13` collision suffixes
- **`getNextVersion()` regex** — handles collision-suffixed filenames (`v002_14`) without breaking version detection
- **UTC timestamp display** — `formatDateTime()` appends `'Z'` to SQLite datetime strings for proper browser timezone conversion
- **`generateVaultName()` destructuring** — returns `{ vaultName, ext }` object, callers now destructure properly (was causing `[object Object]` in DB)
- **Register-in-Place** — fixed undefined `imported` variable, missing `generateVaultName()` call, wrong variable references for thumbnails
- **Shot dropdown empty** — shots table has both `sequence_id` AND `project_id`; both must be updated when migrating hierarchy
