<script lang="ts">
	import { untrack } from 'svelte';
	import HillPlot from '#lib/components/HillPlot.svelte';
	import { HILL_COLORS, HILL_SCOPE_LIMIT, hillPhase } from '#lib/hill.ts';
	import { api } from '#lib/api.ts';
	import { ago, fullDate } from '#lib/format.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import { guardUnsaved } from '#lib/unsaved.ts';
	import type { HillScope } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let scopes = $state<HillScope[]>([]);
	let baseline = $state('[]');
	let revision = $state(-1);
	let milestoneId = $state<number | null>(null);
	let selectedId = $state<number | null>(null);
	let newName = $state('');
	let note = $state('');
	let saving = $state(false);
	let nextId = -1;
	let historyIndex = $state(0);
	const dirty = $derived(JSON.stringify(scopes) !== baseline);
	const unsaved = $derived(dirty || !!note.trim());
	const stale = $derived(revision >= 0 && data.milestone.hillRevision !== revision);
	const snapshot = $derived(
		data.updates[Math.min(historyIndex, Math.max(0, data.updates.length - 1))]
	);
	const completed = $derived(data.milestone.totalCount - data.milestone.openCount);
	const valid = $derived(scopes.every((s) => s.name.trim().length > 0));

	function reset() {
		scopes = data.scopes.map((s) => ({ ...s }));
		baseline = JSON.stringify(scopes);
		revision = data.milestone.hillRevision;
		milestoneId = data.milestone.id;
		selectedId = scopes[0]?.id ?? null;
		note = '';
		newName = '';
		historyIndex = 0;
	}

	$effect(() => {
		const id = data.milestone.id;
		const version = data.milestone.hillRevision;
		// Other refreshes must not discard an in-progress drag or note.
		untrack(() => {
			if (id !== milestoneId || (version !== revision && (!unsaved || saving))) reset();
		});
	});
	guardUnsaved(() => unsaved && !saving, 'Your Hill Chart has unsaved changes. Leave anyway?');

	function addScope() {
		if (!newName.trim() || scopes.length >= HILL_SCOPE_LIMIT || saving) return;
		const id = nextId--;
		scopes = [
			...scopes,
			{
				id,
				name: newName.trim(),
				color: HILL_COLORS[scopes.length % HILL_COLORS.length],
				position: 0
			}
		];
		selectedId = id;
		newName = '';
	}

	function move(id: number, position: number) {
		if (saving) return;
		scopes = scopes.map((s) => (s.id === id ? { ...s, position } : s));
		selectedId = id;
	}

	function remove(id: number) {
		scopes = scopes.filter((s) => s.id !== id);
		if (selectedId === id) selectedId = scopes[0]?.id ?? null;
	}

	async function save() {
		if (!unsaved || !valid || saving || stale) return;
		const input = {
			revision,
			note,
			scopes: scopes.map((s) => ({ ...s, id: s.id > 0 ? s.id : null }))
		};
		saving = true;
		try {
			await api('POST', `/api/milestones/${data.milestone.id}/hill`, input);
			reset();
			historyIndex = 0;
			notify('Hill Chart update saved');
		} catch {
			// api already shows the error; keep the draft available to retry.
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>{data.milestone.name} · Hill Chart · Bugs</title></svelte:head>

<a href="/milestones" class="text-xs text-zinc-500 hover:underline">← Milestones</a>
<div class="mt-3 mb-5 flex flex-wrap items-start justify-between gap-3">
	<div>
		<div class="flex flex-wrap items-center gap-2">
			<h1 class="text-xl font-semibold">{data.milestone.name}</h1>
			{#if data.milestone.done}<span class="chip text-green-600">Completed</span>{/if}
		</div>
		<p class="mt-1 text-sm text-zinc-500">
			{completed}/{data.milestone.totalCount} issues closed{#if data.milestone.dueDate}
				· Due {data.milestone.dueDate}{/if}
		</p>
	</div>
	<a href="/?ms={data.milestone.id}&status=all" class="btn">View issues →</a>
</div>

<section
	class="rounded-lg border border-zinc-200 dark:border-zinc-800"
	aria-label="Milestone Hill Chart"
>
	<div
		class="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800"
	>
		<h2 class="font-semibold">Hill Chart</h2>
		<span class="text-xs text-zinc-500"
			>{scopes.length} piece{scopes.length === 1 ? '' : 's'} of work</span
		>
		{#if unsaved}<span class="ml-auto text-xs text-amber-700 dark:text-amber-400"
				>Unsaved changes</span
			>{/if}
	</div>
	<div class="mx-auto max-w-4xl px-3 pt-6 sm:px-8">
		<HillPlot
			{scopes}
			{selectedId}
			onmove={saving ? undefined : move}
			onselect={(id) => (selectedId = id)}
		/>
	</div>
	<div class="px-4 pb-4 sm:px-6">
		<p class="text-xs text-zinc-500">
			Drag a dot or use its slider below. Uphill: resolve unknowns. At the top: the approach is
			clear. Downhill: finish the work.
		</p>
		{#if !scopes.length}
			<div class="mt-5 rounded-md border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
				<p class="font-medium">What are the main pieces of this milestone?</p>
				<p class="mt-1 text-sm text-zinc-500">
					Add a few, such as “Checkout”, “Email delivery”, or “Launch marketing”. Each gets a dot
					you position yourself.
				</p>
			</div>
		{/if}
		<div class="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
			{#each scopes as scope, i (scope.id)}
				<div
					class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 py-3 sm:grid-cols-[auto_minmax(8rem,1fr)_minmax(8rem,1fr)_auto]"
				>
					<button
						class="flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white outline-offset-2"
						style="background:{scope.color}"
						aria-label="Select {scope.name}"
						onclick={() => (selectedId = scope.id)}>{i + 1}</button
					>
					<input
						class="input w-full min-w-0"
						aria-label="Piece {i + 1} name"
						bind:value={scope.name}
						maxlength="80"
						disabled={saving}
						onfocus={() => (selectedId = scope.id)}
					/>
					<div class="col-start-2 row-start-2 min-w-0 sm:col-start-auto sm:row-start-auto">
						<input
							type="range"
							min="0"
							max="100"
							step="1"
							value={scope.position}
							class="block w-full"
							style="accent-color:{scope.color}"
							aria-label="{scope.name} position"
							aria-valuetext={hillPhase(scope.position)}
							disabled={saving}
							oninput={(e) => move(scope.id, Number(e.currentTarget.value))}
						/>
						<p class="mt-1 text-xs text-zinc-500">{hillPhase(scope.position)}</p>
					</div>
					<button
						class="col-start-3 row-start-1 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 sm:col-start-auto sm:row-start-auto dark:hover:bg-zinc-900"
						aria-label="Remove {scope.name}"
						disabled={saving}
						onclick={() => remove(scope.id)}>✕</button
					>
				</div>
			{/each}
		</div>
		<form
			class="mt-3 flex flex-wrap gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addScope();
			}}
		>
			<input
				class="input min-w-0 flex-1"
				aria-label="New piece of work"
				placeholder="Add a piece of work…"
				bind:value={newName}
				maxlength="80"
				disabled={saving || scopes.length >= HILL_SCOPE_LIMIT}
			/>
			<button class="btn" disabled={!newName.trim() || saving || scopes.length >= HILL_SCOPE_LIMIT}
				>+ Add dot</button
			>
		</form>
		<p class="mt-2 text-xs text-zinc-400">
			Dot positions reflect your understanding of the work. Closing issues leaves them where you put
			them.
		</p>
	</div>
	<div
		class="rounded-b-lg border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
	>
		<label class="mb-1 block text-xs font-medium text-zinc-500" for="hill-note"
			>Update note <span class="font-normal">(optional)</span></label
		>
		<textarea
			id="hill-note"
			class="input w-full resize-y"
			rows="2"
			bind:value={note}
			maxlength="2000"
			placeholder="What did you figure out? What’s still uncertain?"
			disabled={saving}></textarea>
		{#if stale}<p class="mt-2 text-sm text-amber-700 dark:text-amber-400">
				A newer update is available. Cancel your draft to load it before editing.
			</p>{/if}
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<button class="btn-primary" disabled={!unsaved || !valid || saving || stale} onclick={save}
				>{saving ? 'Saving…' : 'Save update'}</button
			>
			{#if unsaved || stale}<button
					class="text-sm text-zinc-500 hover:underline"
					disabled={saving}
					onclick={reset}>Cancel changes</button
				>{/if}
			<span class="text-xs text-zinc-400"
				>{data.updates[0]
					? `Last saved ${ago(data.updates[0].createdAt)}`
					: 'Save your first snapshot to start the history.'}</span
			>
		</div>
	</div>
</section>

{#if snapshot}
	<section
		class="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
		aria-label="Hill Chart history"
	>
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="font-semibold">Progress history</h2>
			<span class="text-xs text-zinc-500"
				>{historyIndex + 1} of {data.updates.length} recent updates</span
			>
			<div class="ml-auto flex gap-2">
				<button
					class="btn py-0.5"
					aria-label="Older snapshot"
					disabled={historyIndex >= data.updates.length - 1}
					onclick={() => historyIndex++}>← Older</button
				>
				<button
					class="btn py-0.5"
					aria-label="Newer snapshot"
					disabled={historyIndex === 0}
					onclick={() => historyIndex--}>Newer →</button
				>
			</div>
		</div>
		<p class="mt-2 text-xs text-zinc-500">
			{fullDate(snapshot.createdAt)}{#if snapshot.userName}
				· {snapshot.userName}{/if}
		</p>
		<div class="mx-auto max-w-3xl pt-4">
			<HillPlot scopes={snapshot.scopes} label="Historical Hill Chart" />
		</div>
		<div class="flex flex-wrap gap-x-4 gap-y-2">
			{#each snapshot.scopes as scope, i (scope.id)}<span class="flex items-center gap-1.5 text-xs"
					><span class="size-2 rounded-full" style="background:{scope.color}"></span>{i + 1}. {scope.name}
					<span class="text-zinc-500">· {hillPhase(scope.position)}</span></span
				>{/each}
		</div>
		{#if snapshot.note}<p
				class="mt-3 border-t border-zinc-100 pt-3 text-sm whitespace-pre-wrap dark:border-zinc-900"
			>
				{snapshot.note}
			</p>{/if}
	</section>
{/if}
