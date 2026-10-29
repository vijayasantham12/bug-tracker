<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, subtitle, children }: { title: string; subtitle?: string; children: Snippet } =
		$props();
</script>

<svelte:head><title>{title} · Bugs</title></svelte:head>

<div class="mx-auto mt-16 max-w-sm rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
	<div class="mb-4">
		<div class="mb-2 text-lg font-semibold">🐞 bugs</div>
		<h1 class="font-medium">{title}</h1>
		{#if subtitle}<p class="mt-1 text-xs text-zinc-500">{subtitle}</p>{/if}
	</div>
	{@render children()}
</div>
