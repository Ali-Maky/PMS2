# Zain PMS - Split & Improved Version

## Overview

This is the improved and split version of the Zain Performance Management System with:

- ✅ **Split Files** - Organized into separate CSS and JS files
- ✅ **Offline Support (PWA)** - Works without internet
- ✅ **Real-Time Sync** - Auto-updates every 30 seconds
- ✅ **Improved CORS** - Fixed for load testing
- ✅ **Better Session Management** - Backend validation

---

## File Structure

```
pms-split/
├── index.html          # Main HTML file
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker for offline support
├── offline.html        # Offline fallback page
├── css/
│   └── styles.css      # All CSS styles (~2,300 lines)
├── js/
│   └── app-bundle.js   # All JavaScript (~9,400 lines)
├── icons/
│   └── icon.svg        # App icon (generate PNGs from this)
└── backend/
    └── index.php       # Improved backend with CORS fix
```

---

## Deployment Instructions

### Step 1: Deploy Backend to Railway

1. Replace your current `index.php` on Railway with `backend/index.php`
2. Set environment variable:
   ```
   APP_ENV=development   # For testing (allows all CORS)
   APP_ENV=prod          # For production (restricts CORS)
   ```
3. If using production, set `ALLOWED_ORIGINS`:
   ```
   ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
   ```

### Step 2: Deploy Frontend

Upload these files to your web hosting (Netlify, Vercel, etc.):

```
index.html
manifest.json
sw.js
offline.html
css/styles.css
js/app-bundle.js
icons/icon.svg
```

### Step 3: Generate App Icons

Use the SVG to generate PNG icons at these sizes:
- 16x16, 32x32, 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512

You can use: https://realfavicongenerator.net/

### Step 4: Update API URL

In `js/app-bundle.js`, find the `API_URL` constant and update it:

```javascript
const API_URL = 'https://your-railway-backend-url.up.railway.app';
```

---

## New Features

### 1. Offline Support

The app now works offline:
- Static files are cached by the Service Worker
- Data is cached in sessionStorage
- Pending changes are saved locally and synced when online

### 2. Real-Time Sync

The app automatically polls for updates:
- Every 30 seconds for data changes
- Progress updates sync automatically
- Team status changes trigger notifications

### 3. Improved CORS

Backend now accepts requests from:
- All origins in development mode
- Specified origins in production mode
- Returns `X-Deny-Reason` header for debugging

### 4. New Backend Endpoints

| Endpoint | Description |
|----------|-------------|
| `?action=health` | Health check for load testing |
| `?action=validateSession` | Validate token |
| `?action=logout` | Invalidate session |
| `?action=extendSession` | Extend session expiry |

---

## Load Testing

With the CORS fix, you can now use the browser-based load tester:

1. Set `APP_ENV=development` on Railway
2. Open `browser-load-tester.html`
3. Enter your backend URL
4. Run tests

---

## PWA Installation

Users can install the app:
1. Visit the site in Chrome/Edge
2. Click "Install" in the address bar
3. App installs as a standalone application

---

## File Sizes

| File | Lines | Size |
|------|-------|------|
| index.html | ~230 | ~15 KB |
| styles.css | ~2,325 | ~65 KB |
| app-bundle.js | ~9,400 | ~380 KB |
| **Total** | ~12,000 | ~460 KB |

This is much more maintainable than a single 12,000-line HTML file!

---

## Rollback

If you need to rollback to the single-file version:
1. Use `index_FINAL_fixed.html` (the original)
2. Restore the original `index.php` on Railway

---

## Support

All original features are preserved:
- ✅ Login/Authentication
- ✅ Scorecard Management
- ✅ Progress Tracking
- ✅ Team Management
- ✅ Admin Functions
- ✅ PDF/Excel Export
- ✅ Dark/Light Mode
- ✅ All other features
