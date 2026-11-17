/// <reference lib="webworker" />
// Minimal worker: makes the app installable, shows push notifications, receives the OS share sheet (share_target in
// the manifest) and shows static/offline.html when a page can't load. It caches only the hashed build assets and
// static files; pages and API calls always go to the network.
import { self } from '$app/service-worker';
import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';
import { SHARE_CACHE, SHARE_META, type SharedMeta } from '#lib/share.ts';

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
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	if (event.request.method === 'POST' && url.pathname === '/share') {
		event.respondWith(receiveShare(event.request));
		return;
	}
	if (event.request.method !== 'GET') return;
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request).catch(
				async () => (await caches.match('/offline.html')) ?? Response.error()
			)
		);
		return;
	}
	if (!PRECACHE.has(url.pathname)) return;
	event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});

// ---------- share target: stash the shared text/files, then open /share to turn them into an issue ----------

async function receiveShare(request: Request) {
	try {
		const form = await request.formData();
		const cache = await caches.open(SHARE_CACHE);
		for (const key of await cache.keys()) await cache.delete(key);
		const field = (name: string) => {
			const v = form.get(name);
			return typeof v === 'string' ? v : '';
		};
		const meta: SharedMeta = {
			title: field('title'),
			text: field('text'),
			url: field('url'),
			files: []
		};
		for (const [i, file] of form.getAll('files').entries()) {
			if (typeof file === 'string') continue;
			const key = `/share/file/${i}`;
			await cache.put(key, new Response(file, { headers: { 'content-type': file.type } }));
			meta.files.push({ key, name: file.name, type: file.type });
		}
		await cache.put(SHARE_META, Response.json(meta));
	} catch {
		// unreadable share: /share opens empty and says so
	}
	return Response.redirect('/share', 303);
}

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
