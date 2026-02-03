/**
 * YouTube Downloader API Server
 * Self-hosted API for WordPress Plugin
 * Deploy to: Railway, Render, Vercel, or any Node.js host
 */

const express = require('express');
const cors = require('cors');
const sanitize = require('sanitize-filename');

// Load ytdl-core
let ytdl;
try {
    ytdl = require('@distube/ytdl-core');
    console.log('✓ @distube/ytdl-core loaded');
} catch (e) {
    console.error('✗ ytdl-core not found');
    process.exit(1);
}

// Load FFmpeg
let ffmpegPath = 'ffmpeg';
let ffmpeg;
try {
    ffmpegPath = require('ffmpeg-static');
    ffmpeg = require('fluent-ffmpeg');
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log('✓ FFmpeg loaded');
} catch (e) {
    console.log('⚠ FFmpeg not available (audio conversion disabled)');
}

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - Allow all origins (or specify your WordPress domain)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

/**
 * Helpers
 */
function isValidVideoId(id) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function formatDuration(sec) {
    if (!sec) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
}

function formatViews(n) {
    if (!n) return '0';
    n = parseInt(n);
    if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
    return n.toString();
}

function formatSize(bytes) {
    if (!bytes) return 'Unknown';
    const s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + s[i];
}

/**
 * API: Health Check
 */
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'YT Downloader API',
        version: '1.0.0',
        endpoints: {
            info: '/api/info?url=YOUTUBE_URL',
            download: '/api/download?url=YOUTUBE_URL&type=video&quality=720'
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * API: Get Video Info
 */
app.get('/api/info', async (req, res) => {
    try {
        let { url, videoId } = req.query;
        
        if (!videoId && url) {
            videoId = extractVideoId(url);
        }
        
        if (!videoId || !isValidVideoId(videoId)) {
            return res.status(400).json({ error: 'Invalid video URL or ID' });
        }
        
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        console.log(`[Info] Fetching: ${videoId}`);
        
        const info = await ytdl.getInfo(videoUrl);
        const details = info.videoDetails;
        const formats = info.formats;
        
        // Process video formats
        const videoFormats = [];
        const audioFormats = [];
        const seenVideo = new Set();
        const seenAudio = new Set();
        
        // Combined formats (video + audio)
        formats.filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4')
            .sort((a, b) => (b.height || 0) - (a.height || 0))
            .forEach(f => {
                const q = `${f.height}p`;
                if (!seenVideo.has(q) && f.height >= 144) {
                    seenVideo.add(q);
                    videoFormats.push({
                        itag: f.itag,
                        quality: q,
                        height: f.height,
                        format: 'mp4',
                        size: formatSize(f.contentLength),
                        hasAudio: true
                    });
                }
            });
        
        // Video-only formats (higher quality)
        formats.filter(f => f.hasVideo && !f.hasAudio)
            .sort((a, b) => (b.height || 0) - (a.height || 0))
            .forEach(f => {
                const q = `${f.height}p`;
                if (!seenVideo.has(q) && f.height >= 144) {
                    seenVideo.add(q);
                    videoFormats.push({
                        itag: f.itag,
                        quality: q,
                        height: f.height,
                        format: 'mp4',
                        size: formatSize(f.contentLength),
                        hasAudio: false
                    });
                }
            });
        
        // Audio formats
        formats.filter(f => f.hasAudio && !f.hasVideo)
            .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))
            .forEach(f => {
                const br = f.audioBitrate || 128;
                const q = `${br}kbps`;
                if (!seenAudio.has(q)) {
                    seenAudio.add(q);
                    audioFormats.push({
                        itag: f.itag,
                        quality: q,
                        bitrate: br,
                        format: 'mp3',
                        size: formatSize(f.contentLength)
                    });
                }
            });
        
        // Sort by quality
        videoFormats.sort((a, b) => b.height - a.height);
        audioFormats.sort((a, b) => b.bitrate - a.bitrate);
        
        res.json({
            success: true,
            videoId,
            title: details.title,
            channelName: details.author?.name || details.ownerChannelName || 'Unknown',
            thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            duration: parseInt(details.lengthSeconds) || 0,
            durationFormatted: formatDuration(parseInt(details.lengthSeconds)),
            viewCount: details.viewCount || '0',
            viewCountFormatted: formatViews(details.viewCount),
            description: (details.description || '').substring(0, 500),
            formats: {
                video: videoFormats,
                audio: audioFormats
            }
        });
        
    } catch (error) {
        console.error('[Error]', error.message);
        res.status(500).json({
            error: 'Failed to fetch video info',
            message: error.message
        });
    }
});

/**
 * API: Download Video/Audio
 */
app.get('/api/download', async (req, res) => {
    try {
        let { url, videoId, type, quality, itag } = req.query;
        
        type = type || 'video';
        quality = parseInt(quality) || 720;
        
        if (!videoId && url) {
            videoId = extractVideoId(url);
        }
        
        if (!videoId || !isValidVideoId(videoId)) {
            return res.status(400).json({ error: 'Invalid video URL or ID' });
        }
        
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        console.log(`[Download] ${videoId} - ${type} - ${quality}`);
        
        const info = await ytdl.getInfo(videoUrl);
        const title = sanitize(info.videoDetails.title) || videoId;
        
        if (type === 'audio') {
            // Audio download
            const filename = `${title}.mp3`;
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            
            const audioFormat = ytdl.chooseFormat(info.formats, {
                quality: 'highestaudio',
                filter: 'audioonly'
            });
            
            const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
            
            if (ffmpeg) {
                ffmpeg(stream)
                    .audioBitrate(quality || 192)
                    .audioCodec('libmp3lame')
                    .format('mp3')
                    .on('error', (err) => console.error('[FFmpeg]', err.message))
                    .pipe(res);
            } else {
                stream.pipe(res);
            }
            
        } else {
            // Video download
            const filename = `${title}.mp4`;
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            
            // Find best format
            let format;
            
            // Try combined format first
            format = info.formats.find(f => 
                f.hasVideo && f.hasAudio && 
                f.container === 'mp4' && 
                f.height === quality
            );
            
            if (!format) {
                // Find closest combined format
                format = info.formats
                    .filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4')
                    .sort((a, b) => Math.abs(a.height - quality) - Math.abs(b.height - quality))[0];
            }
            
            if (format) {
                console.log(`[Download] Using format: ${format.height}p combined`);
                ytdl.downloadFromInfo(info, { format }).pipe(res);
                return;
            }
            
            // Need to merge video + audio
            const videoFormat = info.formats
                .filter(f => f.hasVideo && !f.hasAudio)
                .sort((a, b) => Math.abs(a.height - quality) - Math.abs(b.height - quality))[0];
            
            const audioFormat = info.formats
                .filter(f => f.hasAudio && !f.hasVideo)
                .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
            
            if (videoFormat && audioFormat && ffmpeg) {
                console.log(`[Download] Merging: ${videoFormat.height}p + audio`);
                
                const videoStream = ytdl.downloadFromInfo(info, { format: videoFormat });
                const audioStream = ytdl.downloadFromInfo(info, { format: audioFormat });
                
                ffmpeg()
                    .input(videoStream)
                    .input(audioStream)
                    .outputOptions(['-c:v copy', '-c:a aac', '-movflags frag_keyframe+empty_moov'])
                    .format('mp4')
                    .on('error', (err) => console.error('[FFmpeg]', err.message))
                    .pipe(res);
            } else if (videoFormat) {
                // Video only
                ytdl.downloadFromInfo(info, { format: videoFormat }).pipe(res);
            } else {
                // Fallback
                ytdl(videoUrl, { quality: 'highest' }).pipe(res);
            }
        }
        
    } catch (error) {
        console.error('[Error]', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed', message: error.message });
        }
    }
});

/**
 * API: Get Direct Download URL
 */
app.get('/api/get-url', async (req, res) => {
    try {
        let { url, videoId, type, quality } = req.query;
        
        type = type || 'video';
        quality = parseInt(quality) || 720;
        
        if (!videoId && url) {
            videoId = extractVideoId(url);
        }
        
        if (!videoId || !isValidVideoId(videoId)) {
            return res.status(400).json({ error: 'Invalid video URL or ID' });
        }
        
        // Return download URL to our own endpoint
        const downloadUrl = `${req.protocol}://${req.get('host')}/api/download?videoId=${videoId}&type=${type}&quality=${quality}`;
        
        res.json({
            success: true,
            downloadUrl
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Start Server
 */
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║       YT Downloader API Server v1.0.0              ║
╠════════════════════════════════════════════════════╣
║  Local:  http://localhost:${PORT}                     ║
║                                                    ║
║  Endpoints:                                        ║
║  • GET /api/info?url=YOUTUBE_URL                   ║
║  • GET /api/download?url=URL&type=video&quality=720║
╚════════════════════════════════════════════════════╝
    `);
});
