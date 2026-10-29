import { SvelteMap } from 'svelte/reactivity';
import type { SimilarIssue } from './types';

/**
 * Duplicate hints for titles being typed: debounced lookups, cached per title.
 * Read `hints.get(title)` in markup; call `check(titles)` whenever the titles change.
 */
export class SimilarHints {
	#cache = new SvelteMap<string, SimilarIssue[]>();
	#timer: ReturnType<typeof setTimeout> | undefined;

	get(title: string) {
		return this.#cache.get(title.trim().toLowerCase()) ?? [];
	}

	check(titles: string[], delay = 400) {
		clearTimeout(this.#timer);
		const todo = titles
			.map((t) => t.trim().toLowerCase())
			.filter((t, i, all) => t.length >= 6 && all.indexOf(t) === i && !this.#cache.has(t));
		if (!todo.length) return;
		this.#timer = setTimeout(async () => {
			const res = await fetch('/api/issues/similar', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ titles: todo })
			}).catch(() => null);
			if (!res?.ok) return;
			const { results } = (await res.json()) as { results: SimilarIssue[][] };
			todo.forEach((t, i) => this.#cache.set(t, results[i] ?? []));
		}, delay);
	}
}
