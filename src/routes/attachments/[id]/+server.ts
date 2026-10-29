import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachment } from '#lib/server/repo.ts';
import { s3Enabled, signedUrl, SIGNED_URL_SECONDS } from '#lib/server/s3.ts';

const INLINE = /^(image\/|video\/|audio\/|application\/pdf$|text\/plain$)/;

/** Redirects to a short-lived signed S3 URL. `?download` forces a download. */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!s3Enabled) error(503, 'S3 is not configured');
	const file = await getAttachment(Number(params.id));
	if (!file) error(404, 'Attachment not found');
	const inline = !url.searchParams.has('download') && INLINE.test(file.mime);
	return new Response(null, {
		status: 302,
		headers: {
			location: await signedUrl(file.key, file.filename, inline),
			// let the browser reuse the redirect while the signature is still valid
			'cache-control': `private, max-age=${SIGNED_URL_SECONDS - 60}`
		}
	});
};
