import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

// The service worker normally answers the share sheet's POST itself. If it isn't running yet (first launch),
// the POST lands here: keep the text, drop the files, and show the same page.
export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData().catch(() => new FormData());
		const q = new URLSearchParams();
		for (const name of ['title', 'text', 'url']) {
			const v = form.get(name);
			if (typeof v === 'string' && v) q.set(name, v);
		}
		redirect(303, `/share?${q}`);
	}
};
