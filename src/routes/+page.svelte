<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import TodayToggle from '#lib/components/TodayToggle.svelte';
	import { api } from '#lib/api.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import { nav } from '#lib/nav.svelte.ts';
	import {
		filtersToQuery,
		DATE_FIELDS,
		PAGE_SIZE,
		parseFilters,
		type Filters,
		type Sort
	} from '#lib/filters.ts';
	import {
		ago,
		ENV_CLASS,
		fullDate,
		PRIORITY_CLASS,
		SEVERITY_CLASS,
		TYPE_CLASS
	} from '#lib/format.ts';
	import {
		ENVIRONMENTS,
		PRIORITIES,
		SEVERITIES,
		SIZES,
		TYPES,
		TYPE_LABEL,
		type IssuePatch
	} from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const filters = $derived(parseFilters(page.url.searchParams));
	const statusById = $derived(new Map(data.statuses.map((s) => [s.id, s])));
	const visibleApps = $derived(
		data.apps.filter((a) => !a.archived || filters.apps.includes(a.name))
	);
	const openMilestones = $derived(data.milestones.filter((m) => !m.done));
	const doneMilestones = $derived(data.milestones.filter((m) => m.done));
	// severity / environment only mean something for bugs
	const showBugFilters = $derived(!filters.types.length || filters.types.includes('bug'));
	const selected = new SvelteSet<number>();
	let fresh = $state<number[]>([]);
	let search: HTMLInputElement;
	let q = $state(page.url.searchParams.get('q') ?? '');

	$effect(() => {
		nav.listUrl = page.url.pathname + page.url.search;
	});

	// drop selections that are no longer visible
	$effect(() => {
		const ids = new Set(data.issues.map((i) => i.id));
		for (const id of selected) if (!ids.has(id)) selected.delete(id);
	});

	// any filter or sort change starts again from page 1
	function setFilters(patch: Partial<Filters>) {
		if (patch.apps && patch.inbox === undefined) patch.inbox = false;
		if (patch.inbox) patch.apps = [];
		goto(`/${filtersToQuery({ ...filters, page: 1, ...patch })}`, { replace: true, reset: false });
	}
	const pageUrl = (n: number) => `/${filtersToQuery({ ...filters, page: n })}`;

	function toggle<T>(arr: T[], v: T) {
		return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
	}

	let qTimer: ReturnType<typeof setTimeout>;
	function onSearch() {
		clearTimeout(qTimer);
		qTimer = setTimeout(() => setFilters({ q: q.trim() }), 200);
	}

	function sortBy(s: Sort) {
		if (filters.sort === s) setFilters({ dir: filters.dir === 'asc' ? 'desc' : 'asc' });
		else
			setFilters({
				sort: s,
				dir: ['title', 'app', 'priority', 'status', 'milestone', 'size'].includes(s)
					? 'asc'
					: 'desc'
			});
	}

	const patchOne = (id: number, patch: IssuePatch) => api('PATCH', `/api/issues/${id}`, patch);
	const patchSelected = (patch: IssuePatch) =>
		api('PATCH', '/api/issues', { ids: [...selected], patch });

	async function deleteSelected() {
		if (
			!confirm(
				`Move ${selected.size} issue(s) and their active subtasks to Trash? You can restore them for 30 days.`
			)
		)
			return;
		await api('DELETE', '/api/issues', { ids: [...selected] });
		selected.clear();
	}

	function onadded(ids: number[]) {
		fresh = ids;
		setTimeout(() => (fresh = []), 2500);
	}

	const allSelected = $derived(
		data.issues.length > 0 && data.issues.every((i) => selected.has(i.id))
	);
	const isFiltered = $derived(
		filtersToQuery({ ...filters, sort: 'id', dir: 'desc', page: 1 }) !== ''
	);
	const inboxOnly = $derived(
		filtersToQuery({ ...filters, dateField: 'created', sort: 'id', dir: 'desc', page: 1 }) ===
			'?inbox=1'
	);
	// saved views: the current filters + sort, without the page
	const viewQuery = $derived(filtersToQuery({ ...filters, page: 1 }));
	const activeView = $derived(data.views.find((v) => v.query === viewQuery));
	async function saveCurrentView() {
		const name = prompt('Name this view', activeView?.name ?? '')?.trim();
		if (name) await api('POST', '/api/views', { name, query: viewQuery });
	}
	async function deleteView(id: number, name: string) {
		if (confirm(`Delete the view "${name}"?`)) await api('DELETE', `/api/views/${id}`);
	}

	const pages = $derived(Math.max(1, Math.ceil(data.total / PAGE_SIZE)));
	const first = $derived((filters.page - 1) * PAGE_SIZE + 1);
	const count = $derived(
		data.total > PAGE_SIZE && data.issues.length
			? `${first}–${first + data.issues.length - 1} of ${data.total.toLocaleString()}`
			: `${data.total} issue${data.total === 1 ? '' : 's'}`
	);
	const today = new Date().toISOString().slice(0, 10);

	// optional table columns, hidden per browser
	const OPTIONAL_COLUMNS = [
		{ key: 'milestone', label: 'Milestone' },
		{ key: 'size', label: 'Size' }
	] as const;
	type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]['key'];
	let hiddenColumns = $state<OptionalColumn[]>([]);
	let columnsMenu = $state<HTMLDetailsElement>();
	const showColumn = (c: OptionalColumn) => !hiddenColumns.includes(c);
	function toggleColumn(c: OptionalColumn) {
		hiddenColumns = toggle(hiddenColumns, c);
		try {
			localStorage.setItem('list.hiddenColumns', JSON.stringify(hiddenColumns));
		} catch {
			// storage blocked: the choice just lasts until reload
		}
	}

	// ---------- keyboard triage: j/k move, x select, Enter open, s/p/t/m set a field ----------
	let cursor = $state(-1);
	$effect(() => {
		if (cursor >= data.issues.length) cursor = data.issues.length - 1;
	});
	type PickerKind = 'status' | 'priority' | 'type' | 'milestone';
	interface PickerOption {
		label: string;
		patch: IssuePatch;
		cls?: string;
		color?: string;
	}
	let picker = $state<PickerKind | null>(null);
	const pickerOptions = $derived.by((): PickerOption[] => {
		if (picker === 'status')
			return data.statuses.map((s) => ({
				label: s.name,
				color: s.color,
				patch: { statusId: s.id }
			}));
		if (picker === 'priority')
			return PRIORITIES.map((p) => ({
				label: p.label,
				cls: PRIORITY_CLASS[p.value],
				patch: { priority: p.value }
			}));
		if (picker === 'type')
			return TYPES.map((t) => ({ label: TYPE_LABEL[t], cls: TYPE_CLASS[t], patch: { type: t } }));
		if (picker === 'milestone')
			return [
				{ label: 'No milestone', patch: { milestoneId: null } },
				...openMilestones.map((m) => ({ label: m.name, patch: { milestoneId: m.id } }))
			];
		return [];
	});
	/** selected rows, else the row under the cursor */
	const targets = () =>
		selected.size ? [...selected] : data.issues[cursor] ? [data.issues[cursor].id] : [];
	async function pick(i: number) {
		const option = pickerOptions[i];
		const ids = targets();
		picker = null;
		if (!option || !ids.length) return;
		await api('PATCH', '/api/issues', { ids, patch: option.patch });
		notify(`${ids.length === 1 ? `#${ids[0]}` : `${ids.length} issues`} → ${option.label}`);
	}
	function moveCursor(to: number) {
		cursor = Math.max(0, Math.min(data.issues.length - 1, to));
		document.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
	}
	const PICKER_KEYS: Record<string, PickerKind> = {
		s: 'status',
		p: 'priority',
		t: 'type',
		m: 'milestone'
	};

	function onListKey(e: KeyboardEvent) {
		if (picker) {
			e.preventDefault();
			if (e.key === 'Escape') picker = null;
			// 1–9 then 0 for the 10th option
			else if (/^[0-9]$/.test(e.key)) pick((Number(e.key) + 9) % 10);
			return;
		}
		const k = e.key;
		if (k === 'j' || k === 'ArrowDown') moveCursor(cursor + 1);
		else if (k === 'k' || k === 'ArrowUp') moveCursor(cursor < 0 ? 0 : cursor - 1);
		else if ((k === 'Enter' || k === 'o') && data.issues[cursor])
			goto(`/issues/${data.issues[cursor].id}`);
		else if (k === 'x' && data.issues[cursor]) {
			const id = data.issues[cursor].id;
			if (selected.has(id)) selected.delete(id);
			else selected.add(id);
		} else if (PICKER_KEYS[k] && targets().length) picker = PICKER_KEYS[k];
		else if (k === 'Escape' && (selected.size || cursor >= 0)) {
			if (selected.size) selected.clear();
			else cursor = -1;
		} else return;
		// handled: also stops the layout's `m` → capture shortcut
		e.preventDefault();
	}

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('list.hiddenColumns') ?? '[]');
			if (Array.isArray(saved))
				hiddenColumns = saved.filter((c) => OPTIONAL_COLUMNS.some((o) => o.key === c));
		} catch {
			// unreadable or blocked storage: show all columns
		}

		const onKey = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement).closest('input, textarea, select')) return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === '/') {
				e.preventDefault();
				search.focus();
			} else onListKey(e);
		};
		// close the Columns menu on any click outside it
		const onClick = (e: MouseEvent) => {
			if (columnsMenu?.open && !columnsMenu.contains(e.target as Node)) columnsMenu.open = false;
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('click', onClick);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('click', onClick);
		};
	});
</script>

{#if filters.inbox}
	<div class="mb-3">
		<h1 class="font-semibold">Inbox</h1>
		<p class="mt-1 text-sm text-zinc-500">
			Capture now, organize later. Move an issue to an app when you're ready.
		</p>
	</div>
{/if}

<div class="mb-2 flex justify-end">
	<a href="/dashboard#today" class="text-xs text-amber-700 hover:underline dark:text-amber-400">
		★ Today · {data.todayIds.length} →
	</a>
</div>

<QuickAdd
	inbox={filters.inbox}
	apps={data.apps}
	milestones={data.milestones}
	attachmentsEnabled={data.attachmentsEnabled}
	{onadded}
/>

<!-- saved views -->
{#if data.views.length || isFiltered}
	<div class="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
		<span class="text-zinc-400">Views</span>
		{#each data.views as v (v.id)}
			{@const on = v.id === activeView?.id}
			<span
				class="chip {on
					? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
					: 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}"
			>
				<a href="/{v.query}">★ {v.name}</a>
				{#if on}
					<button
						class="opacity-60 hover:opacity-100"
						title="Delete this view"
						onclick={() => deleteView(v.id, v.name)}>✕</button
					>
				{/if}
			</span>
		{/each}
		{#if isFiltered && !activeView}
			<button class="text-zinc-500 hover:underline" onclick={saveCurrentView}>+ Save view</button>
		{/if}
	</div>
{/if}

<!-- apps -->
<div class="mt-4 flex flex-wrap items-center gap-1.5">
	<button
		class="chip {filters.apps.length || filters.inbox
			? ''
			: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}"
		onclick={() => setFilters({ apps: [] })}
	>
		All apps
	</button>
	<button
		class="chip {filters.inbox ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : ''}"
		onclick={() => setFilters({ inbox: !filters.inbox })}
	>
		Inbox <span class="opacity-60">{data.inboxCount}</span>
	</button>
	{#each visibleApps as a (a.id)}
		{@const on = filters.apps.some((x) => x.toLowerCase() === a.name.toLowerCase())}
		<button
			class="chip {on
				? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
				: 'hover:bg-zinc-100 dark:hover:bg-zinc-900'} {a.archived ? 'opacity-60' : ''}"
			onclick={(e) =>
				setFilters({
					apps:
						e.shiftKey || e.metaKey || e.ctrlKey
							? toggle(filters.apps, a.name)
							: on && filters.apps.length === 1
								? []
								: [a.name]
				})}
			title="Click to filter, Shift+click to add to filter"
		>
			<span class="size-2 rounded-full" style="background:{a.color}"></span>
			{a.name}
			<span class="opacity-60">{a.openCount}</span>
		</button>
	{/each}
</div>

<!-- filters -->
<div class="mt-3 flex flex-wrap items-center gap-2">
	<input
		bind:this={search}
		bind:value={q}
		oninput={onSearch}
		placeholder="Search title, description or #id"
		class="input w-64"
	/>
	<select
		class="input"
		value={filters.status}
		onchange={(e) => setFilters({ status: e.currentTarget.value })}
	>
		<option value="open">Open</option>
		<option value="closed">Closed</option>
		<option value="all">All statuses</option>
		<optgroup label="Status">
			{#each data.statuses as s (s.id)}<option value={String(s.id)} style="color:{s.color}"
					>{s.name}</option
				>{/each}
		</optgroup>
	</select>
	<div class="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
		{#each TYPES as t (t)}
			<button
				class="border-r border-zinc-300 px-2 py-1 last:border-r-0 dark:border-zinc-700 {filters.types.includes(
					t
				)
					? 'bg-zinc-200 dark:bg-zinc-800'
					: 'text-zinc-500'}"
				onclick={() => setFilters({ types: toggle(filters.types, t) })}>{TYPE_LABEL[t]}</button
			>
		{/each}
	</div>
	<div class="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
		{#each PRIORITIES as p (p.value)}
			<button
				title={p.label}
				class="border-r border-zinc-300 px-2 py-1 last:border-r-0 dark:border-zinc-700 {filters.priorities.includes(
					p.value
				)
					? 'bg-zinc-200 dark:bg-zinc-800'
					: 'text-zinc-500'}"
				onclick={() => setFilters({ priorities: toggle(filters.priorities, p.value) })}
				>{p.short}</button
			>
		{/each}
	</div>
	<button
		class="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 {filters.overdue
			? 'bg-zinc-200 text-red-600 dark:bg-zinc-800 dark:text-red-400'
			: 'text-zinc-500'}"
		onclick={() => setFilters({ overdue: !filters.overdue, dueWeek: false })}>Overdue</button
	>
	<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Date range filter">
		<select
			class="input"
			aria-label="Date field"
			value={filters.dateField}
			onchange={(e) => setFilters({ dateField: e.currentTarget.value as Filters['dateField'] })}
		>
			{#each DATE_FIELDS as field (field.value)}<option value={field.value}>{field.label}</option
				>{/each}
		</select>
		<label class="flex items-center gap-1 text-xs text-zinc-500"
			>From
			<input
				type="date"
				class="input"
				value={filters.dateFrom}
				max={filters.dateTo || undefined}
				onchange={(e) => setFilters({ dateFrom: e.currentTarget.value })}
			/>
		</label>
		<label class="flex items-center gap-1 text-xs text-zinc-500"
			>To
			<input
				type="date"
				class="input"
				value={filters.dateTo}
				min={filters.dateFrom || undefined}
				onchange={(e) => setFilters({ dateTo: e.currentTarget.value })}
			/>
		</label>
		{#if filters.dateFrom || filters.dateTo}
			<button
				class="text-xs text-zinc-500 hover:underline"
				onclick={() => setFilters({ dateFrom: '', dateTo: '' })}>Clear dates</button
			>
		{/if}
	</div>
	{#if data.labels.length}
		<select
			class="input"
			value={filters.label}
			onchange={(e) => setFilters({ label: e.currentTarget.value })}
		>
			<option value="">Any label</option>
			{#each data.labels as l (l)}<option value={l}>+{l}</option>{/each}
		</select>
	{/if}
	{#if data.milestones.length}
		<select
			class="input"
			value={filters.milestone}
			onchange={(e) => setFilters({ milestone: e.currentTarget.value })}
		>
			<option value="">Any milestone</option>
			<option value="none">No milestone</option>
			{#each openMilestones as m (m.id)}<option value={String(m.id)}>^{m.name}</option>{/each}
			{#if doneMilestones.length}
				<optgroup label="Done">
					{#each doneMilestones as m (m.id)}<option value={String(m.id)}>^{m.name}</option>{/each}
				</optgroup>
			{/if}
		</select>
	{/if}
	{#if showBugFilters}
		<select
			class="input"
			value={filters.severities.join(',')}
			onchange={(e) =>
				setFilters({
					severities: e.currentTarget.value ? (e.currentTarget.value.split(',') as never) : []
				})}
		>
			<option value="">Any severity</option>
			<option value="critical,major">Critical + major</option>
			{#each SEVERITIES as sv (sv.value)}<option value={sv.value} class={SEVERITY_CLASS[sv.value]}
					>{sv.label}</option
				>{/each}
		</select>
		<select
			class="input"
			value={filters.envs.join(',')}
			onchange={(e) =>
				setFilters({ envs: e.currentTarget.value ? [e.currentTarget.value as never] : [] })}
		>
			<option value="">Any environment</option>
			{#each ENVIRONMENTS as en (en.value)}<option value={en.value} class={ENV_CLASS[en.value]}
					>{en.label}</option
				>{/each}
		</select>
	{/if}
	{#snippet activeChip(text: string, clear: Partial<Filters>)}
		<button
			class="chip border-zinc-900 dark:border-zinc-100"
			title="Remove this filter"
			onclick={() => setFilters(clear)}>{text} ✕</button
		>
	{/snippet}
	{#if filters.sizes.length}
		{@render activeChip(`Size ${filters.sizes.join(', ').toUpperCase()}`, { sizes: [] })}
	{/if}
	{#if filters.milestone && filters.milestone !== 'none'}
		<a href="/milestones/{filters.milestone}" class="text-xs text-zinc-500 hover:underline"
			>Milestone Hill Chart →</a
		>
	{/if}
	{#if filters.dueWeek}{@render activeChip('Due this week', { dueWeek: false })}{/if}
	{#if filters.blocked}{@render activeChip('Blocked', { blocked: false })}{/if}
	{#if filters.parent}
		<button
			class="chip border-zinc-900 dark:border-zinc-100"
			title="Show all issues"
			onclick={() => setFilters({ parent: null })}>Subtasks of #{filters.parent} ✕</button
		>
	{/if}
	{#if isFiltered}
		<button
			class="text-zinc-500 hover:underline"
			onclick={() => {
				q = '';
				setFilters({
					...parseFilters(new URLSearchParams()),
					sort: filters.sort,
					dir: filters.dir
				});
			}}>Clear</button
		>
	{/if}
	<span class="ml-auto text-zinc-400">{count}</span>
	<details class="relative" bind:this={columnsMenu}>
		<summary
			class="cursor-pointer list-none rounded px-1.5 py-0.5 text-zinc-500 select-none hover:bg-zinc-100 dark:hover:bg-zinc-900"
			title="Show or hide columns">Columns ▾</summary
		>
		<div
			class="absolute right-0 z-20 mt-1 w-36 rounded border border-zinc-200 bg-white p-1.5 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
		>
			{#each OPTIONAL_COLUMNS as c (c.key)}
				<label
					class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900"
				>
					<input type="checkbox" checked={showColumn(c.key)} onchange={() => toggleColumn(c.key)} />
					{c.label}
				</label>
			{/each}
		</div>
	</details>
</div>

<!-- bulk actions -->
{#if selected.size}
	<div
		class="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded border border-zinc-300 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
	>
		<span class="font-medium">{selected.size} selected</span>
		<select
			class="input py-0.5"
			onchange={(e) => {
				patchSelected({ statusId: Number(e.currentTarget.value) });
				e.currentTarget.value = '';
			}}
		>
			<option value="">Status…</option>
			{#each data.statuses as s (s.id)}<option value={s.id} style="color:{s.color}">{s.name}</option
				>{/each}
		</select>
		<select
			class="input py-0.5"
			onchange={(e) => {
				patchSelected({ priority: Number(e.currentTarget.value) });
				e.currentTarget.value = '';
			}}
		>
			<option value="">Priority…</option>
			{#each PRIORITIES as p (p.value)}<option value={p.value} class={PRIORITY_CLASS[p.value]}
					>{p.label}</option
				>{/each}
		</select>
		<select
			class="input py-0.5"
			onchange={(e) => {
				patchSelected({ type: e.currentTarget.value as never });
				e.currentTarget.value = '';
			}}
		>
			<option value="">Type…</option>
			{#each TYPES as t (t)}<option value={t} class={TYPE_CLASS[t]}>{TYPE_LABEL[t]}</option>{/each}
		</select>
		<select
			class="input py-0.5"
			onchange={(e) => {
				patchSelected({
					appId: e.currentTarget.value === 'inbox' ? null : Number(e.currentTarget.value)
				});
				e.currentTarget.value = '';
			}}
		>
			<option value="">Move to app…</option>
			<option value="inbox">Inbox (no app)</option>
			{#each data.apps as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
		</select>
		<select
			class="input py-0.5"
			onchange={(e) => {
				const v = e.currentTarget.value;
				patchSelected({ milestoneId: v === 'none' ? null : Number(v) });
				e.currentTarget.value = '';
			}}
		>
			<option value="">Milestone…</option>
			<option value="none">No milestone</option>
			{#each openMilestones as m (m.id)}<option value={m.id}>^{m.name}</option>{/each}
		</select>
		<select
			class="input py-0.5"
			onchange={(e) => {
				const v = e.currentTarget.value;
				patchSelected({ size: v === 'none' ? null : (v as never) });
				e.currentTarget.value = '';
			}}
		>
			<option value="">Size…</option>
			<option value="none">No size</option>
			{#each SIZES as sz (sz)}<option value={sz}>{sz.toUpperCase()}</option>{/each}
		</select>
		<button class="btn-danger py-0.5" onclick={deleteSelected}>Move to Trash</button>
		<button class="ml-auto text-zinc-500 hover:underline" onclick={() => selected.clear()}
			>Clear selection</button
		>
	</div>
{/if}

<!-- table -->
{#snippet th(label: string, s: Sort, cls = '')}
	<th class="px-2 py-1.5 font-medium {cls}">
		<button class="hover:text-zinc-900 dark:hover:text-white" onclick={() => sortBy(s)}>
			{label}{filters.sort === s ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : ''}
		</button>
	</th>
{/snippet}

<div class="mt-3 overflow-x-auto">
	<table class="w-full border-collapse text-left">
		<thead class="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
			<tr>
				<th class="w-6 px-2">
					<input
						type="checkbox"
						checked={allSelected}
						onchange={() =>
							allSelected ? selected.clear() : data.issues.forEach((i) => selected.add(i.id))}
					/>
				</th>
				{@render th('#', 'id', 'w-14')}
				{@render th('Title', 'title')}
				{@render th('App', 'app', 'w-32')}
				{@render th('Type', 'type', 'w-24')}
				{@render th('Status', 'status', 'w-32')}
				{@render th('Priority', 'priority', 'w-24')}
				{#if showColumn('milestone')}{@render th('Milestone', 'milestone', 'w-28')}{/if}
				{#if showColumn('size')}{@render th('Size', 'size', 'w-14')}{/if}
				{@render th('Updated', 'updated', 'w-24')}
			</tr>
		</thead>
		<tbody>
			{#each data.issues as issue, idx (issue.id)}
				{@const status = statusById.get(issue.statusId)}
				<tr
					data-row={idx}
					class="group border-b border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60 {cursor ===
					idx
						? 'outline outline-1 -outline-offset-1 outline-zinc-400 dark:outline-zinc-500'
						: ''} {fresh.includes(issue.id)
						? 'bg-amber-50 dark:bg-amber-950/40'
						: ''} {selected.has(issue.id) ? 'bg-zinc-100 dark:bg-zinc-900' : ''}"
				>
					<td class="px-2">
						<input
							type="checkbox"
							checked={selected.has(issue.id)}
							onchange={() =>
								selected.has(issue.id) ? selected.delete(issue.id) : selected.add(issue.id)}
						/>
					</td>
					<td class="px-2 py-1.5 text-xs text-zinc-400">
						<a href="/issues/{issue.id}" class="hover:underline">#{issue.id}</a>
					</td>
					<td class="px-2 py-1.5">
						{#if !status?.isClosed}
							<TodayToggle issueId={issue.id} selected={data.todayIds.includes(issue.id)} compact />
						{/if}
						{#if issue.parentId}
							<a
								href="/issues/{issue.parentId}"
								class="mr-1 text-xs text-zinc-400 hover:underline"
								title="Subtask of #{issue.parentId}">↳#{issue.parentId}</a
							>
						{/if}
						<a
							href="/issues/{issue.id}"
							class="hover:underline {status?.isClosed
								? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-700'
								: ''}"
						>
							{issue.title}
						</a>
						{#if issue.remindAt}
							<span
								class="ml-1 text-xs text-zinc-400"
								title="Reminder {issue.remindAt.toLocaleString()}">🔔</span
							>
						{/if}
						{#if issue.repeat}
							<span class="ml-1 text-xs text-zinc-400" title="Repeats {issue.repeat}">↻</span>
						{/if}
						{#if issue.isBlocked && !status?.isClosed}
							<span class="ml-1 text-xs text-red-500" title="Blocked by an open issue"
								>⛔ blocked</span
							>
						{/if}
						{#if issue.type === 'bug' && issue.severity}
							<button
								class="ml-1 text-xs {SEVERITY_CLASS[issue.severity]} hover:underline"
								title="Severity"
								onclick={() => setFilters({ severities: [issue.severity!] })}
								>{issue.severity}</button
							>
						{/if}
						{#if issue.type === 'bug' && issue.environment}
							<button
								class="ml-1 text-xs {ENV_CLASS[issue.environment]} hover:underline"
								title="Environment"
								onclick={() => setFilters({ envs: [issue.environment!] })}
								>{ENVIRONMENTS.find((x) => x.value === issue.environment)?.short}</button
							>
						{/if}
						{#if issue.subtaskCount}
							<button
								class="ml-1 text-xs hover:underline {issue.subtaskDone === issue.subtaskCount
									? 'text-green-600 dark:text-green-400'
									: 'text-zinc-400'}"
								title="Subtasks done — click to list them"
								onclick={() => setFilters({ parent: issue.id, status: 'all' })}
								>☑ {issue.subtaskDone}/{issue.subtaskCount}</button
							>
						{/if}
						{#each issue.labels as l (l)}
							<button
								class="ml-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
								onclick={() => setFilters({ label: l })}>+{l}</button
							>
						{/each}
						{#if issue.commentCount}<span class="ml-1 text-xs text-zinc-400" title="Comments"
								>💬{issue.commentCount}</span
							>{/if}
						{#if issue.attachmentCount}<span class="ml-1 text-xs text-zinc-400" title="Attachments"
								>📎{issue.attachmentCount}</span
							>{/if}
						{#if issue.dueDate}
							<span
								class="ml-1 text-xs {issue.dueDate < today && !status?.isClosed
									? 'text-red-500'
									: 'text-zinc-400'}"
								title="Due">⏰ {issue.dueDate}</span
							>
						{/if}
					</td>
					<td class="px-2 py-1.5 whitespace-nowrap">
						{#if issue.appId === null}
							<select
								class="cell-select text-zinc-500"
								value=""
								aria-label="Move issue #{issue.id} to app"
								onchange={(e) => patchOne(issue.id, { appId: Number(e.currentTarget.value) })}
							>
								<option value="">Inbox → move to…</option>
								{#each data.apps.filter((a) => !a.archived) as a (a.id)}<option value={a.id}
										>{a.name}</option
									>{/each}
							</select>
						{:else}
							<button
								class="inline-flex items-center gap-1.5 hover:underline"
								onclick={() => setFilters({ apps: [issue.appName] })}
							>
								<span class="size-2 rounded-full" style="background:{issue.appColor}"
								></span>{issue.appName}
							</button>
						{/if}
					</td>
					<td class="px-2 py-1.5">
						<select
							class="cell-select {TYPE_CLASS[issue.type]}"
							value={issue.type}
							onchange={(e) => patchOne(issue.id, { type: e.currentTarget.value as never })}
						>
							{#each TYPES as t (t)}<option value={t} class={TYPE_CLASS[t]}>{TYPE_LABEL[t]}</option
								>{/each}
						</select>
					</td>
					<td class="px-2 py-1.5">
						<select
							class="cell-select"
							style="color:{status?.color}"
							value={issue.statusId}
							onchange={(e) => patchOne(issue.id, { statusId: Number(e.currentTarget.value) })}
						>
							{#each data.statuses as s (s.id)}<option value={s.id} style="color:{s.color}"
									>{s.name}</option
								>{/each}
						</select>
					</td>
					<td class="px-2 py-1.5">
						<select
							class="cell-select {PRIORITY_CLASS[issue.priority]}"
							value={issue.priority}
							onchange={(e) => patchOne(issue.id, { priority: Number(e.currentTarget.value) })}
						>
							{#each PRIORITIES as p (p.value)}<option
									value={p.value}
									class={PRIORITY_CLASS[p.value]}>{p.label}</option
								>{/each}
						</select>
					</td>
					{#if showColumn('milestone')}
						<td class="px-2 py-1.5">
							<select
								class="cell-select max-w-28 truncate {issue.milestoneId
									? ''
									: 'text-zinc-300 dark:text-zinc-700'}"
								value={issue.milestoneId ?? ''}
								onchange={(e) =>
									patchOne(issue.id, {
										milestoneId: e.currentTarget.value ? Number(e.currentTarget.value) : null
									})}
							>
								<option value="">—</option>
								{#each data.milestones.filter((m) => !m.done || m.id === issue.milestoneId) as m (m.id)}<option
										value={m.id}>{m.name}</option
									>{/each}
							</select>
						</td>
					{/if}
					{#if showColumn('size')}
						<td class="px-2 py-1.5">
							<select
								class="cell-select uppercase {issue.size ? '' : 'text-zinc-300 dark:text-zinc-700'}"
								value={issue.size ?? ''}
								onchange={(e) =>
									patchOne(issue.id, { size: (e.currentTarget.value || null) as never })}
							>
								<option value="">—</option>
								{#each SIZES as sz (sz)}<option value={sz}>{sz.toUpperCase()}</option>{/each}
							</select>
						</td>
					{/if}
					<td
						class="px-2 py-1.5 text-xs whitespace-nowrap text-zinc-400"
						title="Updated {fullDate(issue.updatedAt)} · created {fullDate(issue.createdAt)}"
					>
						{ago(issue.updatedAt)}
					</td>
				</tr>
			{:else}
				<tr>
					<td
						colspan={8 + OPTIONAL_COLUMNS.filter((c) => showColumn(c.key)).length}
						class="py-12 text-center text-zinc-400"
					>
						{#if data.total}
							Page {filters.page} is past the end.
							<a href={pageUrl(pages)} class="underline">Go to page {pages}</a>
						{:else if inboxOnly}
							Inbox is clear. Capture an idea above whenever you need to.
						{:else if isFiltered}
							No issues match these filters.
						{:else}
							No issues yet — add one above (press n).
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<p class="mt-2 hidden text-xs text-zinc-400 md:block">
	<span class="kbd">j</span>/<span class="kbd">k</span> move · <span class="kbd">x</span> select ·
	<span class="kbd">Enter</span> open · <span class="kbd">s</span> status ·
	<span class="kbd">p</span> priority · <span class="kbd">t</span> type ·
	<span class="kbd">m</span> milestone — for the selected rows, or the one under the cursor ·
	<span class="kbd">Esc</span> clear
</p>

{#if picker}
	<div
		class="fixed bottom-6 left-1/2 z-30 w-72 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
		role="dialog"
		aria-label="Set {picker}"
	>
		<div class="mb-1 px-1 text-xs text-zinc-500">
			Set {picker} for {selected.size || 1} issue{(selected.size || 1) === 1 ? '' : 's'}
		</div>
		{#each pickerOptions.slice(0, 10) as o, i (o.label)}
			<button
				class="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
				onclick={() => pick(i)}
			>
				<span class="kbd">{(i + 1) % 10}</span>
				<span class={o.cls} style={o.color ? `color:${o.color}` : ''}>{o.label}</span>
			</button>
		{/each}
		<div class="mt-1 px-1 text-xs text-zinc-400">
			press a number · <span class="kbd">Esc</span> cancel
		</div>
	</div>
{/if}

{#if pages > 1}
	<nav class="mt-3 flex items-center justify-end gap-2 text-zinc-500">
		<span class="mr-auto text-zinc-400">{count}</span>
		{#snippet pageLink(label: string, n: number)}
			{#if n >= 1 && n <= pages && n !== filters.page}
				<a href={pageUrl(n)} class="btn">{label}</a>
			{:else}
				<span class="btn pointer-events-none opacity-40">{label}</span>
			{/if}
		{/snippet}
		{@render pageLink('« First', 1)}
		{@render pageLink('← Prev', filters.page - 1)}
		<span class="px-1">Page {Math.min(filters.page, pages)} of {pages}</span>
		{@render pageLink('Next →', filters.page + 1)}
		{@render pageLink('Last »', pages)}
	</nav>
{/if}
