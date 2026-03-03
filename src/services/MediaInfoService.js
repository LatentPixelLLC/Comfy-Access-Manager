/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * This source code is proprietary and confidential. Unauthorized copying,
 * modification, distribution, or use of this file is strictly prohibited.
 * See LICENSE file for details.
 */
/**
 * MediaVault - Media Info Service
 * Extracts metadata from media files (resolution, duration, FPS, codec)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { findFFprobe: _sharedFindFFprobe } = require('../utils/ffmpegUtils');

class MediaInfoService {

    /**
     * Extract metadata from a media file using FFprobe
     * @param {string} filePath 
     * @returns {Promise<object>} { width, height, duration, fps, codec, bitrate }
     */
    static async probe(filePath) {
        const ffprobePath = this.findFFprobe();
        if (!ffprobePath) {
            // Fallback: just read file size
            const stats = fs.statSync(filePath);
            return { width: null, height: null, duration: null, fps: null, codec: null, fileSize: stats.size };
        }

        return new Promise((resolve) => {
            const args = [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filePath
            ];

            execFile(ffprobePath, args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
                if (err) {
                    // Silently fall back to basic stats
                    const stats = fs.statSync(filePath);
                    resolve({ width: null, height: null, duration: null, fps: null, codec: null, fileSize: stats.size });
                    return;
                }

                try {
                    const info = JSON.parse(stdout);
                    const videoStream = (info.streams || []).find(s => s.codec_type === 'video');
                    const audioStream = (info.streams || []).find(s => s.codec_type === 'audio');

                    let fps = null;
                    if (videoStream?.r_frame_rate) {
                        const [num, den] = videoStream.r_frame_rate.split('/');
                        fps = den ? parseFloat(num) / parseFloat(den) : parseFloat(num);
                        fps = Math.round(fps * 100) / 100;
                    }

                    resolve({
                        width: videoStream ? parseInt(videoStream.width) : null,
                        height: videoStream ? parseInt(videoStream.height) : null,
                        duration: info.format?.duration ? parseFloat(info.format.duration) : null,
                        fps,
                        codec: videoStream?.codec_name || audioStream?.codec_name || null,
                        bitrate: info.format?.bit_rate ? parseInt(info.format.bit_rate) : null,
                        fileSize: fs.statSync(filePath).size,
                        audioCodec: audioStream?.codec_name || null,
                        sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : null,
                    });
                } catch (parseErr) {
                    const stats = fs.statSync(filePath);
                    resolve({ width: null, height: null, duration: null, fps: null, codec: null, fileSize: stats.size });
                }
            });
        });
    }

    /**
     * Get image dimensions using sharp (fast, no FFprobe needed)
     */
    static async getImageDimensions(filePath) {
        try {
            const sharp = require('sharp');
            const metadata = await sharp(filePath).metadata();
            return {
                width: metadata.width,
                height: metadata.height,
                fileSize: fs.statSync(filePath).size,
                codec: metadata.format,
                space: metadata.space,
                channels: metadata.channels,
                density: metadata.density,
            };
        } catch {
            // Fall back to FFprobe
            return this.probe(filePath);
        }
    }

    /**
     * Find FFprobe in common locations
     */
    static findFFprobe() {
        return _sharedFindFFprobe();
    }
}

module.exports = MediaInfoService;
