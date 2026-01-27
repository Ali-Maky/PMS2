/**
 * Zain PMS Service Worker
 * Provides offline support and caching for the Performance Management System
 * Version: 2.0
 */

const CACHE_NAME = 'zain-pms-v2';
const OFFLINE_URL = '/offline.html';

// Files to cache for offline use
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app-bundle.js',
    '/offline.html',
    '/manifest.json',
    '/icon.svg'
];

// API endpoints that should NOT be cached (always fetch fresh)
const NO_CACHE_PATTERNS = [
    /\?action=login/,
    /\?action=saveUser/,
    /\?action=saveSettings/,
    /\?action=bulkUpsert/,
    /\?action=deleteUser/,
    /\?action=rpcPublish/,
    /\?action=validateSession/,
    /\?action=logout/,
    /\?action=extendSession/
];

// API endpoints that can be cached briefly
const API_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Install event - precache static assets
self.addEventListener('install', event => {
    console.log('[SW] Installing Service Worker...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Precaching app shell...');
                return cache.addAll(PRECACHE_URLS.filter(url => !url.startsWith('http')))
                    .catch(err => {
                        console.warn('[SW] Some precache URLs failed:', err);
                    });
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating Service Worker...');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) {
        return;
    }
    
    // Check if this is an API request that should not be cached
    const isNoCacheApi = NO_CACHE_PATTERNS.some(pattern => pattern.test(url.search));
    if (isNoCacheApi) {
        // Network only for sensitive endpoints
        event.respondWith(
            fetch(request)
                .catch(() => {
                    return new Response(
                        JSON.stringify({ error: true, message: 'Network unavailable' }),
                        { status: 503, headers: { 'Content-Type': 'application/json' } }
                    );
                })
        );
        return;
    }
    
    // Check if this is an API data fetch (can be cached briefly)
    const isApiDataFetch = url.search.includes('action=fetchAll') || 
                           url.search.includes('action=getSettings') ||
                           url.search.includes('action=getCycles');
    
    if (isApiDataFetch) {
        // Network first, cache fallback for data
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Clone and cache the response
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Fallback to cache
                    return caches.match(request)
                        .then(cachedResponse => {
                            if (cachedResponse) {
                                console.log('[SW] Serving cached API data:', url.pathname);
                                return cachedResponse;
                            }
                            return new Response(
                                JSON.stringify({ error: true, message: 'Offline - no cached data' }),
                                { status: 503, headers: { 'Content-Type': 'application/json' } }
                            );
                        });
                })
        );
        return;
    }
    
    // For static assets - cache first, network fallback
    event.respondWith(
        caches.match(request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Return cached version and update in background
                    event.waitUntil(
                        fetch(request)
                            .then(networkResponse => {
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(request, networkResponse);
                                });
                            })
                            .catch(() => {})
                    );
                    return cachedResponse;
                }
                
                // Not in cache - fetch from network
                return fetch(request)
                    .then(response => {
                        // Cache successful responses
                        if (response.status === 200) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(request, responseClone);
                            });
                        }
                        return response;
                    })
                    .catch(() => {
                        // Offline fallback for navigation requests
                        if (request.mode === 'navigate') {
                            return caches.match(OFFLINE_URL);
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});

// Handle messages from the main thread
self.addEventListener('message', event => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    
    if (event.data === 'clearCache') {
        caches.delete(CACHE_NAME).then(() => {
            console.log('[SW] Cache cleared');
        });
    }
    
    if (event.data.type === 'CACHE_DATA') {
        // Cache specific data from the app
        const { key, data } = event.data;
        caches.open(CACHE_NAME).then(cache => {
            const response = new Response(JSON.stringify(data), {
                headers: { 'Content-Type': 'application/json' }
            });
            cache.put(key, response);
        });
    }
});

// Background sync for offline actions
self.addEventListener('sync', event => {
    if (event.tag === 'sync-drafts') {
        event.waitUntil(syncDrafts());
    }
});

// Sync drafts when back online
async function syncDrafts() {
    const cache = await caches.open(CACHE_NAME);
    const pendingDrafts = await cache.match('pending-drafts');
    
    if (pendingDrafts) {
        const drafts = await pendingDrafts.json();
        
        for (const draft of drafts) {
            try {
                await fetch(draft.url, {
                    method: 'POST',
                    headers: draft.headers,
                    body: JSON.stringify(draft.body)
                });
            } catch (err) {
                console.error('[SW] Failed to sync draft:', err);
            }
        }
        
        // Clear pending drafts
        await cache.delete('pending-drafts');
    }
}

// Push notification handling (for future use)
self.addEventListener('push', event => {
    if (!event.data) return;
    
    const data = event.data.json();
    const options = {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/'
        },
        actions: data.actions || []
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'Zain PMS', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    const url = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                // Focus existing window if open
                for (const client of clientList) {
                    if (client.url.includes(url) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

console.log('[SW] Service Worker loaded');
