<script lang="ts">
	import { applySuggestion, suggest, tokenAt, type Suggestion, type Token } from '#lib/complete.ts';

	/**
	 * Suggestion row for a quick-add textarea: `@app`, `^milestone`, `+label`, `*due`.
	 * Tab (or a click) takes the first suggestion; Esc hides them. Handled keys are
	 * `preventDefault`ed, so the textarea's own handlers can check `e.defaultPrevented`.
	 */
	let {
		input,
		apps,
		milestones
	}: { input: HTMLTextAreaElement | undefined; apps: string[]; milestones: string[] } = $props();

	let token = $state<Token | null>(null);
	let hidden = $state(false);
	let labels = $state<string[]>([]);
	const items = $derived<Suggestion[]>(
		token && !hidden ? suggest(token, { apps, milestones, labels }) : []
	);
	const LABEL = { '@': 'apps', '^': 'milestones', '+': 'labels', '*': 'due' } as const;

	// labels aren't in page data everywhere; fetch them on focus, at most every 30 s
	let fetchedAt = 0;
	async function loadLabels() {
		if (Date.now() - fetchedAt < 30_000) return;
		fetchedAt = Date.now();
		const res = await fetch('/api/labels').catch(() => null);
		if (res?.ok) labels = ((await res.json()) as { labels: string[] }).labels;
	}

	function update() {
		if (!input) return;
		const next =
			input.selectionStart === input.selectionEnd
				? tokenAt(input.value, input.selectionStart)
				: null;
		if (next?.start !== token?.start || next?.sigil !== token?.sigil) hidden = false;
		token = next;
	}

	function accept(s: Suggestion) {
		if (!input || !token) return;
		const { text, caret } = applySuggestion(input.value, token, s.value);
		input.value = text;
		input.setSelectionRange(caret, caret);
		// keeps bind:value in the parent in sync
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.focus();
		update();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!items.length) return;
		if (e.key === 'Tab' && !e.shiftKey) {
			e.preventDefault();
			accept(items[0]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			hidden = true;
		}
	}

	const onBlur = () => setTimeout(() => (token = null), 150);

	// direct listeners run before Svelte's delegated handlers on the textarea
	$effect(() => {
		const el = input;
		if (!el) return;
		const events = ['input', 'click', 'keyup', 'focus'] as const;
		for (const ev of events) el.addEventListener(ev, update);
		el.addEventListener('keydown', onKeydown);
		el.addEventListener('focus', loadLabels);
		el.addEventListener('blur', onBlur);
		return () => {
			for (const ev of events) el.removeEventListener(ev, update);
			el.removeEventListener('keydown', onKeydown);
			el.removeEventListener('focus', loadLabels);
			el.removeEventListener('blur', onBlur);
		};
	});
</script>

{#if items.length}
	<div class="flex flex-wrap items-center gap-1 px-3 py-1 text-xs">
		<span class="text-zinc-400">{token ? LABEL[token.sigil] : ''}</span>
		{#each items as s, i (s.value)}
			<button
				type="button"
				class="rounded border px-1.5 py-0.5 {i === 0
					? 'border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800'
					: 'border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800'}"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => accept(s)}
			>
				{token?.sigil}{s.value}{#if s.hint}<span class="ml-1 text-zinc-400">{s.hint}</span>{/if}
			</button>
		{/each}
		<span class="text-zinc-400"
			><span class="kbd">Tab</span> pick · <span class="kbd">Esc</span> hide</span
		>
	</div>
{/if}
