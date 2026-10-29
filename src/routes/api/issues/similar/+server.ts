import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { similarIssues } from '#lib/server/repo.ts';

const MAX_TITLES = 40;

/** { titles: string[] } → { results: SimilarIssue[][] } in the same order */
export const POST: RequestHandler = async ({ request }) => {
	const { titles } = (await request.json()) as { titles: string[] };
	const list = (Array.isArray(titles) ? titles : []).slice(0, MAX_TITLES).map(String);
	return json({ results: await Promise.all(list.map(similarIssues)) });
};
