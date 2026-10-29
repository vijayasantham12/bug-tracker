<script lang="ts">
	import { api } from '#lib/api.ts';
	import { goto } from '$app/navigation';
	import type { Milestone } from '#lib/types.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let name = $state('');
	let busy = $state(false);
	const active = $derived(data.milestones.filter((m) => !m.done));
	const completed = $derived(data.milestones.filter((m) => m.done));
	async function create() {
		if (!name.trim() || busy) return;
		busy = true;
		try {
			const { id } = await api<{ id: number }>('POST', '/api/milestones', { name });
			name = '';
			await goto(`/milestones/${id}`);
		} catch {
			/* api displays the error */
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Milestones · Bugs</title></svelte:head>

<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-xl font-semibold">Milestones</h1>
		<p class="mt-1 text-sm text-zinc-500">
			Track what’s finished and what you’re still figuring out.
		</p>
	</div>
	<a href="/settings#milestones" class="text-sm text-zinc-500 hover:underline"
		>Manage milestones →</a
	>
</div>
<form
	class="mb-5 flex max-w-lg gap-2"
	onsubmit={(e) => {
		e.preventDefault();
		create();
	}}
>
	<input
		class="input min-w-0 flex-1"
		bind:value={name}
		maxlength="40"
		aria-label="Milestone name"
		placeholder="New milestone…"
		disabled={busy}
	/>
	<button class="btn-primary" disabled={!name.trim() || busy}
		>{busy ? 'Creating…' : 'Create milestone'}</button
	>
</form>

{#snippet milestoneCards(items: Milestone[])}
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each items as milestone (milestone.id)}
			{@const done = milestone.totalCount - milestone.openCount}
			<a
				href="/milestones/{milestone.id}"
				class="rounded-lg border border-zinc-200 p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
			>
				<h2 class="font-semibold">{milestone.name}</h2>
				<p class="mt-1 text-xs text-zinc-500">
					{done}/{milestone.totalCount} issues closed{#if milestone.dueDate}
						· Due {milestone.dueDate}{/if}
				</p>
				<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
					<div
						class="h-full bg-green-500"
						style="width:{milestone.totalCount ? (done / milestone.totalCount) * 100 : 0}%"
					></div>
				</div>
				<p class="mt-4 text-sm text-zinc-500">
					{milestone.hillRevision ? 'Open Hill Chart' : 'Set up Hill Chart'} →
				</p>
			</a>
		{/each}
	</div>
{/snippet}

{#if active.length}{@render milestoneCards(active)}{:else}<p
		class="rounded-lg border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700"
	>
		No active milestones. Create one above, or use <code>^milestone</code> when adding an issue.
	</p>{/if}
{#if completed.length}<details class="mt-6">
		<summary class="mb-3 cursor-pointer text-sm text-zinc-500"
			>Completed milestones · {completed.length}</summary
		>{@render milestoneCards(completed)}
	</details>{/if}
