/// <reference lib="webworker" />
// Minimal worker: makes the app installable and shows push notifications. It caches only the hashed build assets
// and static files; pages and API calls always go to the network.
import { self } from '$app/service-worker';
import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';

const CACHE = `bugs-${version}`;
const PRECACHE = new Set([...immutable, ...assets].map((f) => f.path));

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((c) => c.addAll([...PRECACHE])));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || !PRECACHE.has(url.pathname)) return;
	event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});

// ---------- push notifications (payload: { title, body, url, tag } from src/lib/server/push.ts) ----------

self.addEventListener('push', (event) => {
	const data = (() => {
		try {
			return event.data?.json() as { title?: string; body?: string; url?: string; tag?: string };
		} catch {
			return { body: event.data?.text() };
		}
	})();
	event.waitUntil(
		self.registration.showNotification(data?.title || 'Bugs', {
			body: data?.body,
			tag: data?.tag,
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			data: { url: data?.url || '/' }
		})
	);
});

// focus an open tab and navigate it, or open a new one
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = new URL(
		(event.notification.data as { url?: string })?.url || '/',
		self.location.origin
	).href;
	event.waitUntil(
		(async () => {
			const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin) as
				WindowClient | undefined;
			if (tab) {
				await tab.focus();
				await tab.navigate(url).catch(() => self.clients.openWindow(url));
			} else await self.clients.openWindow(url);
		})()
	);
});
