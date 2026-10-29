import type { PageServerLoad } from './$types';
import { dashboard } from '#lib/server/repo.ts';

export const load: PageServerLoad = async () => dashboard();
