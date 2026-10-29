import { error } from '@sveltejs/kit';
import { ATTACHMENT_MAX_MB } from '$app/env/private';
import { addAttachments } from './repo';
import { attachmentKey, deleteObjects, putObject, s3Enabled } from './s3';

// browsers (and curl) often send no type or octet-stream for less common extensions
const MIME_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	pdf: 'application/pdf',
	txt: 'text/plain',
	log: 'text/plain',
	json: 'application/json'
};

export function mimeFor(name: string, type = '') {
	if (type && type !== 'application/octet-stream') return type;
	return MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export interface Upload {
	name: string;
	type?: string;
	data: ArrayBuffer | Uint8Array<ArrayBuffer>;
}

/** Puts files in S3 and records them on the issue; removes the S3 objects again if the DB write fails. */
export async function storeAttachments(issueId: number, files: Upload[], userId: number) {
	if (!s3Enabled) error(503, 'Attachments are disabled: S3 is not configured');
	const tooBig = files.find((f) => f.data.byteLength > ATTACHMENT_MAX_MB * 1024 * 1024);
	if (tooBig) error(413, `${tooBig.name} is larger than ${ATTACHMENT_MAX_MB} MB`);

	const uploaded = await Promise.all(
		files.map(async (f) => {
			const name = f.name || 'file';
			const mime = mimeFor(name, f.type);
			const key = attachmentKey(issueId, name);
			await putObject(key, f.data, mime);
			return { filename: name, mime, size: f.data.byteLength, key };
		})
	).catch((e: Error) => error(502, e.message));

	try {
		await addAttachments(issueId, uploaded, userId);
	} catch (e) {
		await deleteObjects(uploaded.map((u) => u.key));
		throw e;
	}
}
