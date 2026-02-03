# YT Downloader API Server

Your own YouTube downloader API. Deploy to Railway, Render, or any Node.js host.

## Quick Deploy

### Option 1: Railway (Recommended - Free)

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub"
3. Connect your GitHub and upload this folder
4. Railway will auto-deploy
5. Copy your API URL (e.g., `https://yt-api-xxxxx.railway.app`)

### Option 2: Render (Free)

1. Go to [render.com](https://render.com)
2. New → Web Service
3. Connect GitHub repo with this folder
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Copy your API URL

### Option 3: Local/VPS

```bash
npm install
npm start
```

Server runs on port 3000 (or PORT env variable)

## API Endpoints

### Get Video Info
```
GET /api/info?url=https://youtube.com/watch?v=VIDEO_ID
```

### Download Video
```
GET /api/download?videoId=VIDEO_ID&type=video&quality=720
GET /api/download?videoId=VIDEO_ID&type=audio&quality=192
```

## WordPress Integration

After deploying, add your API URL to WordPress:
1. Go to WP Admin → YT Downloader
2. Enter your API URL (e.g., `https://yt-api-xxxxx.railway.app`)
3. Save

Done! Downloads now use YOUR OWN server.
