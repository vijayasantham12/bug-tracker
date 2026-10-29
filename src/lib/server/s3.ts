import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import {
	S3_ACCESS_KEY_ID,
	S3_BUCKET,
	S3_ENDPOINT,
	S3_PREFIX,
	S3_REGION,
	S3_SECRET_ACCESS_KEY
} from '$app/env/private';

const client =
	S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
		? new AwsClient({
				accessKeyId: S3_ACCESS_KEY_ID,
				secretAccessKey: S3_SECRET_ACCESS_KEY,
				region: S3_REGION,
				service: 's3'
			})
		: null;

export const s3Enabled = client !== null;

function s3() {
	if (!client)
		throw new Error('S3 is not configured (set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
	return client;
}

/** Path-style for custom endpoints (R2, MinIO, …), virtual-hosted for AWS. */
function objectUrl(key: string) {
	const path = key.split('/').map(encodeURIComponent).join('/');
	return S3_ENDPOINT
		? `${S3_ENDPOINT.replace(/\/+$/, '')}/${S3_BUCKET}/${path}`
		: `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${path}`;
}

export function attachmentKey(issueId: number, filename: string) {
	const safe = filename.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';
	return `${S3_PREFIX}issues/${issueId}/${randomUUID()}/${safe}`;
}

export async function putObject(
	key: string,
	body: ArrayBuffer | Uint8Array<ArrayBuffer>,
	contentType: string
) {
	const res = await s3().fetch(objectUrl(key), {
		method: 'PUT',
		body,
		headers: { 'content-type': contentType }
	});
	if (!res.ok)
		throw new Error(`S3 upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

/** Best effort: a missing object is not an error. */
export async function deleteObjects(keys: string[]) {
	if (!client || !keys.length) return;
	await Promise.allSettled(keys.map((k) => client.fetch(objectUrl(k), { method: 'DELETE' })));
}

/** Checked deletion for the retryable Trash cleanup queue. */
export async function deleteObject(key: string) {
	const res = await s3().fetch(objectUrl(key), { method: 'DELETE' });
	if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status})`);
}

export const SIGNED_URL_SECONDS = 300;

/** Short-lived GET URL; `inline` lets the browser display images/PDFs instead of downloading. */
export async function signedUrl(key: string, filename: string, inline: boolean) {
	const url = new URL(objectUrl(key));
	url.searchParams.set('X-Amz-Expires', String(SIGNED_URL_SECONDS));
	url.searchParams.set(
		'response-content-disposition',
		`${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`
	);
	const signed = await s3().sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
	return signed.url;
}

/** Object body, or null if it doesn't exist. */
export async function getObject(key: string): Promise<Uint8Array | null> {
	const res = await s3().fetch(objectUrl(key));
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`S3 download failed (${res.status})`);
	return new Uint8Array(await res.arrayBuffer());
}

/** Keys under a prefix (first 1000, plenty for daily backups). */
export async function listKeys(prefix: string): Promise<string[]> {
	const url = new URL(objectUrl(''));
	url.searchParams.set('list-type', '2');
	url.searchParams.set('prefix', prefix);
	const res = await s3().fetch(url);
	if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
	return [...(await res.text()).matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
		m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
	);
}
