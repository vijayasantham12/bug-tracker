<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { api } from '#lib/api.ts';
	import type { Issue, Status } from '#lib/types.ts';

	let { issues, statuses }: { issues: Issue[]; statuses: Status[] } = $props();
	let ordered = $derived(issues);
	let busy = $state(false);
	let dragging = $state<number | null>(null);
	let dropTarget = $state<number | null>(null);
	let announcement = $state('');
	const statusById = $derived(new Map(statuses.map((s) => [s.id, s])));
	const doneStatus = $derived(
		statuses.find((s) => s.isClosed && s.name.toLowerCase() === 'done') ??
			statuses.find((s) => s.isClosed)
	);

	async function move(id: number, to: number) {
		if (busy || to < 0 || to >= ordered.length) return;
		const from = ordered.findIndex((i) => i.id === id);
		if (from < 0 || from === to) return;
		const next = [...ordered];
		const [issue] = next.splice(from, 1);
		next.splice(to, 0, issue);
		ordered = next;
		busy = true;
		try {
			await api('PATCH', '/api/today', { ids: next.map((i) => i.id) });
			announcement = `${issue.title} moved to position ${to + 1}`;
		} catch {
			ordered = issues;
			// A second device may have changed the list while it was being reordered.
			await refreshAll().catch(() => {});
		} finally {
			busy = false;
		}
	}

	async function finish(issue: Issue) {
		if (busy || !doneStatus) return;
		busy = true;
		try {
			await api('PATCH', `/api/issues/${issue.id}`, { statusId: doneStatus.id });
			announcement = `${issue.title} completed`;
		} catch {
			// The API helper displays errors.
		} finally {
			busy = false;
		}
	}

	async function remove(issue: Issue) {
		if (busy) return;
		busy = true;
		try {
			await api('DELETE', '/api/today', { issueId: issue.id });
			announcement = `${issue.title} removed from Today`;
		} catch {
			// The API helper displays errors.
		} finally {
			busy = false;
		}
	}

	function startDrag(event: DragEvent, id: number) {
		if (busy || !event.dataTransfer) {
			event.preventDefault();
			return;
		}
		dragging = id;
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', String(id));
	}

	function endDrag() {
		dragging = null;
		dropTarget = null;
	}
</script>

<section
	id="today"
	class="mb-6 scroll-mt-4 rounded border border-amber-200 bg-amber-50/30 p-3 dark:border-amber-900/60 dark:bg-amber-950/10"
	aria-labelledby="today-heading"
	aria-busy={busy}
>
	<div class="mb-1 flex items-baseline gap-2">
		<h1
			id="today-heading"
			class="text-xs font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400"
		>
			Today · {ordered.length}
		</h1>
		<a href="/" class="ml-auto text-xs text-zinc-500 hover:underline">Choose issues →</a>
	</div>
	<p class="mb-3 text-xs text-zinc-500">
		Pick 1–3 issues to focus on. Unfinished work stays here until you finish or remove it.
	</p>
	{#if ordered.length}
		<ol class="divide-y divide-amber-100 dark:divide-amber-950">
			{#each ordered as issue, index (issue.id)}
				<li
					class="flex flex-wrap items-center gap-2 rounded py-2 {dropTarget === issue.id
						? 'bg-amber-100/70 dark:bg-amber-900/30'
						: ''} {dragging === issue.id ? 'opacity-50' : ''}"
					ondragover={(event) => {
						if (dragging === null || busy || dragging === issue.id) return;
						event.preventDefault();
						if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
						dropTarget = issue.id;
					}}
					ondrop={(event) => {
						if (dragging === null) return;
						event.preventDefault();
						void move(dragging, index);
						endDrag();
					}}
				>
					<button
						type="button"
						class="cursor-grab rounded px-1 text-zinc-400 active:cursor-grabbing disabled:opacity-40"
						draggable={!busy}
						disabled={busy}
						aria-label="Drag to reorder #{issue.id}"
						title="Drag to reorder, or use the up/down buttons"
						ondragstart={(event) => startDrag(event, issue.id)}
						ondragend={endDrag}>⠿</button
					>
					<span class="w-4 text-xs text-zinc-400 tabular-nums" aria-hidden="true">{index + 1}</span>
					<button
						type="button"
						class="size-6 shrink-0 rounded border border-zinc-300 text-zinc-400 hover:border-green-500 hover:text-green-600 disabled:opacity-40 dark:border-zinc-700"
						disabled={busy || !doneStatus}
						aria-label="Mark #{issue.id} as {doneStatus?.name ?? 'done'}"
						title={doneStatus
							? `Mark as ${doneStatus.name}`
							: 'Add a closed status in Settings to complete issues'}
						onclick={() => finish(issue)}>✓</button
					>
					<div class="min-w-0 flex-1 basis-36">
						<a href="/issues/{issue.id}" class="break-words hover:underline">{issue.title}</a>
						{#if issue.nextAction || issue.stopped}
							<p
								class="mt-1 line-clamp-2 text-xs break-words text-zinc-600 dark:text-zinc-400"
								title={issue.nextAction || issue.stopped}
							>
								<span class="font-medium">{issue.nextAction ? 'Next:' : 'Stopped:'}</span>
								{issue.nextAction || issue.stopped}
							</p>
						{/if}
						<div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
							<span class="font-sans">#{issue.id}</span>
							<span class="inline-flex items-center gap-1"
								><span class="size-1.5 rounded-full" style="background:{issue.appColor}"
								></span>{issue.appName}</span
							>
							<span style="color:{statusById.get(issue.statusId)?.color}"
								>{statusById.get(issue.statusId)?.name}</span
							>
							{#if issue.isBlocked}<span class="text-red-500">⛔ blocked</span>{/if}
						</div>
					</div>
					<div class="ml-auto flex items-center gap-1">
						<button
							type="button"
							class="rounded px-2 py-1 text-zinc-500 hover:bg-amber-100 disabled:opacity-30 dark:hover:bg-amber-950"
							aria-label="Move #{issue.id} up"
							title="Move up"
							disabled={busy || index === 0}
							onclick={() => move(issue.id, index - 1)}>↑</button
						>
						<button
							type="button"
							class="rounded px-2 py-1 text-zinc-500 hover:bg-amber-100 disabled:opacity-30 dark:hover:bg-amber-950"
							aria-label="Move #{issue.id} down"
							title="Move down"
							disabled={busy || index === ordered.length - 1}
							onclick={() => move(issue.id, index + 1)}>↓</button
						>
						<button
							type="button"
							class="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
							aria-label="Remove #{issue.id} from Today"
							title="Remove from Today (keeps the issue)"
							disabled={busy}
							onclick={() => remove(issue)}>✕</button
						>
					</div>
				</li>
			{/each}
		</ol>
		<p class="mt-2 text-xs text-zinc-400">Drag the handle or use ↑ / ↓ to set your order.</p>
	{:else}
		<p class="py-2 text-zinc-500">
			Nothing picked yet. Use <span class="text-amber-700 dark:text-amber-400">☆</span> beside an issue
			or add one from the suggestions below.
		</p>
	{/if}
	<p class="sr-only" role="status">{announcement}</p>
</section>
