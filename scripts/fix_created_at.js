#!/usr/bin/env node
/**
 * fix_created_at.js — Backfill created_at with actual file mtime
 *
 * For every asset whose created_at was set to import time (datetime('now')),
 * stat the file on disk and update created_at to the file's real mtime.
 *
 * Usage:  node scripts/fix_created_at.js [--dry-run]
 */
'use strict';

const path = require('path');
const fs   = require('fs');

// Bootstrap database
process.chdir(path.join(__dirname, '..'));
const { initDb, getDb } = require('../src/database');
initDb();
const db = getDb();

const dryRun = process.argv.includes('--dry-run');

// Try to resolve cross-platform paths
let resolveFilePath;
try {
    resolveFilePath = require('../src/utils/pathResolver').resolveFilePath;
} catch {
    resolveFilePath = p => p;  // fallback: identity
}

const assets = db.prepare('SELECT id, file_path, created_at FROM assets').all();
console.log(`Found ${assets.length} assets total`);

let updated = 0, skipped = 0, missing = 0;

const updateStmt = db.prepare('UPDATE assets SET created_at = ? WHERE id = ?');

for (const asset of assets) {
    const resolved = resolveFilePath(asset.file_path);
    if (!resolved || !fs.existsSync(resolved)) {
        missing++;
        continue;
    }

    try {
        const stat = fs.statSync(resolved);
        const mtime = stat.mtime.toISOString();

        // Skip if created_at already looks like a real date (not import time)
        // We consider it "needs fix" if the file mtime differs by > 60 seconds
        const existingDate = new Date(asset.created_at).getTime();
        const fileMtime    = stat.mtime.getTime();
        if (Math.abs(existingDate - fileMtime) < 60000) {
            skipped++;
            continue;
        }

        if (dryRun) {
            console.log(`  [dry-run] #${asset.id}: ${asset.created_at} -> ${mtime}`);
        } else {
            updateStmt.run(mtime, asset.id);
        }
        updated++;
    } catch (err) {
        console.error(`  Error on asset #${asset.id}: ${err.message}`);
        skipped++;
    }
}

console.log(`\nDone${dryRun ? ' (DRY RUN)' : ''}:`);
console.log(`  Updated: ${updated}`);
console.log(`  Skipped: ${skipped} (already correct)`);
console.log(`  Missing: ${missing} (file not found on disk)`);
