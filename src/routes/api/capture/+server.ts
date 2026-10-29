import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseQuickAdd } from '#lib/quickadd.ts';
import { addLink, cleanUrl, createIssues, lastUsedApp } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';
import { cleanNewIssues } from '#lib/server/validate.ts';
import { storeAttachments } from '#lib/server/attachments.ts';
import { s3Enabled } from '#lib/server/s3.ts';
import { afterIssuesCreated } from '#lib/server/notify.ts';

interface CaptureBody {
	/** quick-add syntax, one issue per line */
	text?: string;
	/**
	 * Base64 of whatever was shared (the iOS Shortcut sends its input this way, since JSON
	 * passes the CSRF check and multipart from another app doesn't). Images are attached;
	 * a shared URL becomes a link; other text goes in the description.
	 */
	content?: string;
	filename?: string;
	/** used when the text has no @app; defaults to the app of your last issue */
	app?: string;
}

const IMAGE_MAGIC: [string, number[], number?][] = [
	['image/png', [0x89, 0x50, 0x4e, 0x47]],
	['image/jpeg', [0xff, 0xd8, 0xff]],
	['image/gif', [0x47, 0x49, 0x46]],
	['image/webp', [0x57, 0x45, 0x42, 0x50], 8],
	['image/heic', [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69], 4]
];
function imageType(bytes: Uint8Array) {
	return IMAGE_MAGIC.find(([, sig, at = 0]) => sig.every((b, i) => bytes[at + i] === b))?.[0];
}
const EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/heic': 'heic'
};

/** One-shot capture for scripts and the iOS Shortcut: JSON in, issue ids and URLs out. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const user = requireUser(locals);
	const body = (await request.json().catch(() => null)) as CaptureBody | null;
	if (!body) error(400, 'Send JSON: { "text": "…", "content": "<base64>" }');

	const bytes = body.content ? new Uint8Array(Buffer.from(body.content, 'base64')) : null;
	const mime = bytes?.length ? imageType(bytes) : undefined;
	const sharedText = bytes?.length && !mime ? new TextDecoder().decode(bytes).trim() : '';
	const sharedUrl = sharedText ? cleanUrl(sharedText.split(/\s+/)[0]) : null;

	let text = (body.text ?? '').trim();
	if (!text) text = mime ? 'Shared screenshot' : sharedText.split('\n')[0].slice(0, 120);
	if (!text) error(400, 'Nothing to add: send some text or an image');

	const app = body.app?.trim() || (await lastUsedApp(user.id));
	const items = cleanNewIssues(
		parseQuickAdd(text).map((it) => ({
			...it,
			apps: it.apps.length ? it.apps : app ? [app] : [],
			description: [it.description, sharedText && !sharedUrl ? sharedText : '']
				.filter(Boolean)
				.join('\n\n')
		}))
	);
	if (!items.length) error(400, 'Add an app with @app (no apps exist yet)');

	const { ids } = await createIssues(items, user.id);
	afterIssuesCreated(ids, user.id);
	for (const id of ids) {
		if (sharedUrl) await addLink(id, sharedUrl, null, user.id);
		if (mime && bytes && s3Enabled)
			await storeAttachments(
				id,
				[{ name: body.filename || `capture.${EXT[mime]}`, type: mime, data: bytes }],
				user.id
			);
	}
	return json({
		ids,
		urls: ids.map((id) => `${url.origin}/issues/${id}`),
		message: ids.length === 1 ? `Added #${ids[0]}` : `Added ${ids.length} issues`,
		...(mime && !s3Enabled ? { warning: 'Image not attached: S3 is not configured' } : {})
	});
};
