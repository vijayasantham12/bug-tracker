<script lang="ts">
	import type { Attachment } from '#lib/types.ts';

	/** `index` is the open item, or null when closed. */
	let { items, index = $bindable() }: { items: Attachment[]; index: number | null } = $props();

	const current = $derived(index === null ? null : items[index]);

	function step(delta: number) {
		if (index !== null) index = (index + delta + items.length) % items.length;
	}

	// capture phase on window runs before the page's own shortcuts (e.g. Esc = back to list)
	$effect(() => {
		if (index === null) return;
		const onKey = (e: KeyboardEvent) => {
			const action = {
				Escape: () => (index = null),
				ArrowLeft: () => step(-1),
				ArrowRight: () => step(1)
			}[e.key];
			if (!action) return;
			e.preventDefault();
			e.stopPropagation();
			action();
		};
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		window.addEventListener('keydown', onKey, { capture: true });
		return () => {
			document.body.style.overflow = overflow;
			window.removeEventListener('keydown', onKey, { capture: true });
		};
	});
</script>

{#if current && index !== null}
	<div
		class="fixed inset-0 z-50 flex flex-col bg-black/90 text-zinc-200"
		role="dialog"
		aria-modal="true"
	>
		<div class="flex items-center gap-3 px-4 py-2 text-sm">
			<span class="truncate">{current.filename}</span>
			{#if items.length > 1}<span class="text-zinc-500">{index + 1} / {items.length}</span>{/if}
			<a href="/attachments/{current.id}?download" class="ml-auto hover:text-white" title="Download"
				>↓</a
			>
			<a
				href="/attachments/{current.id}"
				target="_blank"
				rel="noopener"
				class="hover:text-white"
				title="Open original">↗</a
			>
			<button class="text-lg hover:text-white" title="Close (Esc)" onclick={() => (index = null)}
				>✕</button
			>
		</div>

		<!-- clicking the empty area around the media closes the viewer -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="relative flex min-h-0 flex-1 items-center justify-center p-4"
			onclick={(e) => e.target === e.currentTarget && (index = null)}
		>
			{#key current.id}
				{#if current.mime.startsWith('video/')}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src="/attachments/{current.id}" controls autoplay class="max-h-full max-w-full"
					></video>
				{:else}
					<img
						src="/attachments/{current.id}"
						alt={current.filename}
						class="max-h-full max-w-full object-contain"
					/>
				{/if}
			{/key}

			{#if items.length > 1}
				<button
					class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl hover:bg-black/80"
					title="Previous (←)"
					onclick={() => step(-1)}>‹</button
				>
				<button
					class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl hover:bg-black/80"
					title="Next (→)"
					onclick={() => step(1)}>›</button
				>
			{/if}
		</div>
	</div>
{/if}
