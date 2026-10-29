import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listLabels } from '#lib/server/repo.ts';

export const GET: RequestHandler = async () => json({ labels: await listLabels() });
