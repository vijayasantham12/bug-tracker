import { refreshAll } from '$app/navigation';
import { notify } from './toast.svelte';

/** JSON request to our API; refreshes page data on success, toasts on failure. */
export async function api<T = { ok: true }>(
	method: string,
	url: string,
	body?: unknown
): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) {
		const message = (await res.json().catch(() => null))?.message ?? res.statusText;
		notify(message, true);
		throw new Error(message);
	}
	const data = (await res.json()) as T;
	await refreshAll();
	return data;
}

/** Uploads files to an issue; refreshes page data on success, toasts on failure. */
export async function upload(issueId: number, files: File[], refresh = true) {
	const body = new FormData();
	for (const f of files) body.append('file', f);
	const res = await fetch(`/api/issues/${issueId}/attachments`, { method: 'POST', body });
	if (!res.ok) {
		const message = (await res.json().catch(() => null))?.message ?? res.statusText;
		notify(message, true);
		throw new Error(message);
	}
	if (refresh) await refreshAll();
}

/**
 * Files from a paste or drop. Clipboard screenshots all arrive as "image.png",
 * so they get a timestamped name instead.
 */
export function filesFrom(dt: DataTransfer | null): File[] {
	if (!dt) return [];
	const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
	return [...dt.files].map((f, i) =>
		f.name === 'image.png' || !f.name
			? new File([f], `screenshot-${stamp}${i ? `-${i}` : ''}.${f.type.split('/')[1] || 'bin'}`, {
					type: f.type
				})
			: f
	);
}
