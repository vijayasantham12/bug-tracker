<script lang="ts">
	import TrendChart from '#lib/components/TrendChart.svelte';
	import { ago, PRIORITY_CLASS, TYPE_CLASS } from '#lib/format.ts';
	import { PRIORITIES, TYPE_LABEL, type Issue } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const f = $derived(data.fires);
	const statusById = $derived(new Map(data.statuses.map((s) => [s.id, s])));
	// same rule as the server: open, not default, not named Blocked
	const inProgressIds = $derived(
		data.statuses
			.filter((s) => !s.isClosed && !s.isDefault && s.name.toLowerCase() !== 'blocked')
			.map((s) => s.id)
	);
	const defaultStatus = $derived(data.statuses.find((s) => s.isDefault));

	const next = $derived(data.milestones.find((m) => m.total > m.done) ?? data.milestones[0]);
	const later = $derived(data.milestones.filter((m) => m !== next));
	const DAY = 86_400_000;
	const today = new Date(new Date().toDateString()).getTime();
	function dueText(due: string | null) {
		if (!due) return '';
		const days = Math.round((new Date(`${due}T00:00:00`).getTime() - today) / DAY);
		if (days === 0) return 'due today';
		return days > 0 ? `due in ${days} day${days === 1 ? '' : 's'}` : `${-days} days late`;
	}

	const trendTotals = $derived(
		data.trend.reduce((t, w) => ({ created: t.created + w.created, closed: t.closed + w.closed }), {
			created: 0,
			closed: 0
		})
	);
	const net = $derived(trendTotals.created - trendTotals.closed);

	const fireRows = $derived([
		{
			label: 'production bugs (critical / major)',
			value: f.prodBugs,
			href: '/?type=bug&env=production&sev=critical,major'
		},
		{ label: 'overdue', value: f.overdue, href: '/?due=overdue' },
		{ label: 'due this week', value: f.dueWeek, href: '/?due=week' },
		{ label: 'blocked', value: f.blocked, href: '/?blocked=1' }
	]);
	const calm = $derived(fireRows.every((r) => r.value === 0));
</script>

<svelte:head><title>Dashboard · Bugs</title></svelte:head>

{#snippet card(title: string, href?: string, extra?: string)}
	<div class="mb-2 flex items-baseline gap-2">
		<h2 class="text-xs font-medium tracking-wide text-zinc-500 uppercase">{title}</h2>
		{#if extra}<span class="text-xs text-zinc-400">{extra}</span>{/if}
		{#if href}<a {href} class="ml-auto text-xs text-zinc-400 hover:underline">all →</a>{/if}
	</div>
{/snippet}

{#snippet row(i: Issue, meta: 'status' | 'priority' | 'closed' = 'priority')}
	{@const st = statusById.get(i.statusId)}
	<li class="flex items-baseline gap-2 py-1">
		<span class="w-10 shrink-0 font-mono text-xs text-zinc-400">#{i.id}</span>
		<a href="/issues/{i.id}" class="min-w-0 truncate hover:underline">{i.title}</a>
		{#if i.isBlocked}<span class="shrink-0 text-xs text-red-500">⛔</span>{/if}
		<span class="ml-auto flex shrink-0 items-baseline gap-2 text-xs">
			<span class="flex items-center gap-1 text-zinc-500"
				><span class="size-1.5 rounded-full" style="background:{i.appColor}"
				></span>{i.appName}</span
			>
			{#if i.size}<span class="w-5 text-zinc-400 uppercase">{i.size}</span>{/if}
			{#if meta === 'status'}
				<span class="w-20 truncate text-right" style="color:{st?.color}">{st?.name}</span>
			{:else if meta === 'closed'}
				<span class="w-20 text-right text-zinc-400">{i.closedAt ? ago(i.closedAt) : ''}</span>
			{:else}
				<span class="w-12 text-right {PRIORITY_CLASS[i.priority]}"
					>{PRIORITIES[i.priority].label}</span
				>
			{/if}
		</span>
	</li>
{/snippet}

<div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
	<!-- Now -->
	<section class="rounded border border-zinc-200 p-3 dark:border-zinc-800">
		{@render card(
			`In progress · ${data.inProgress.length}`,
			inProgressIds.length ? `/?status=${inProgressIds.join(',')}` : undefined
		)}
		{#if data.inProgress.length}
			<ul class="divide-y divide-zinc-100 dark:divide-zinc-900">
				{#each data.inProgress as i (i.id)}{@render row(i, 'status')}{/each}
			</ul>
		{:else}
			<p class="py-2 text-zinc-400">Nothing in progress — pick something from Up next.</p>
		{/if}

		<div class="mt-4">
			{@render card(
				'Up next',
				defaultStatus ? `/?status=${defaultStatus.id}&sort=priority&dir=asc` : undefined,
				'highest priority, not started, not blocked'
			)}
			{#if data.upNext.length}
				<ul class="divide-y divide-zinc-100 dark:divide-zinc-900">
					{#each data.upNext as i (i.id)}{@render row(i)}{/each}
				</ul>
			{:else}
				<p class="py-2 text-zinc-400">Nothing waiting. 🎉</p>
			{/if}
		</div>
	</section>

	<div class="space-y-6">
		<!-- Fires -->
		<section
			class="rounded border p-3 {calm
				? 'border-zinc-200 dark:border-zinc-800'
				: 'border-red-200 dark:border-red-900/60'}"
		>
			{@render card('Fires')}
			{#if calm}
				<p class="text-zinc-400">✓ Nothing urgent — no production bugs, overdue or blocked work.</p>
			{:else}
				<ul class="space-y-1">
					{#each fireRows as r (r.label)}
						<li>
							<a href={r.href} class="flex items-baseline gap-2 hover:underline">
								<span
									class="w-8 text-right text-lg font-semibold tabular-nums {r.value
										? 'text-red-600 dark:text-red-400'
										: 'text-zinc-300 dark:text-zinc-700'}">{r.value}</span
								>
								<span class={r.value ? '' : 'text-zinc-400'}>{r.label}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Quick wins -->
		<section class="rounded border border-zinc-200 p-3 dark:border-zinc-800">
			{@render card('Quick wins', '/?size=xs,s&sort=priority&dir=asc', 'XS / S, not started')}
			{#if data.quickWins.length}
				<ul class="divide-y divide-zinc-100 dark:divide-zinc-900">
					{#each data.quickWins as i (i.id)}
						<li class="flex items-baseline gap-2 py-1">
							<span class="font-mono text-xs text-zinc-400">#{i.id}</span>
							<a href="/issues/{i.id}" class="min-w-0 truncate hover:underline">{i.title}</a>
							<span class="ml-auto shrink-0 text-xs text-zinc-400 uppercase">{i.size}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-zinc-400">No small issues. Set Size (XS / S) on issues to see them here.</p>
			{/if}
		</section>
	</div>
</div>

<!-- Milestone -->
<section class="mt-6 rounded border border-zinc-200 p-3 dark:border-zinc-800">
	{#if next}
		{@const pct = next.total ? (next.done / next.total) * 100 : 0}
		{@const left = next.total - next.done}
		{@const late = !!next.dueDate && dueText(next.dueDate).endsWith('late') && left > 0}
		<div class="mb-2 flex flex-wrap items-baseline gap-x-2">
			<h2 class="text-xs font-medium tracking-wide text-zinc-500 uppercase">Next milestone</h2>
			<a href="/?ms={next.id}&status=all" class="font-semibold hover:underline">{next.name}</a>
			{#if next.dueDate}<span class="text-xs {late ? 'text-red-500' : 'text-zinc-500'}"
					>{dueText(next.dueDate)}</span
				>{/if}
			<a href="/settings" class="ml-auto text-xs text-zinc-400 hover:underline">manage →</a>
		</div>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span class="h-2.5 min-w-40 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
				<span class="block h-full rounded-full bg-green-500" style="width:{pct}%"></span>
			</span>
			<span class="shrink-0 text-sm tabular-nums">
				{next.done}/{next.total} done
				{#if left}
					· <a href="/?ms={next.id}" class="hover:underline">{left} left</a>
					<span class="text-xs text-zinc-500"
						>({[
							next.openBugs && `${next.openBugs} bug${next.openBugs === 1 ? '' : 's'}`,
							next.openFeatures &&
								`${next.openFeatures} feature${next.openFeatures === 1 ? '' : 's'}`,
							next.openOther && `${next.openOther} other`
						]
							.filter(Boolean)
							.join(', ')})</span
					>
				{/if}
			</span>
		</div>
		{#if later.length}
			<div class="mt-2 flex flex-wrap gap-x-4 text-xs text-zinc-500">
				<span class="text-zinc-400">later:</span>
				{#each later as m (m.id)}
					<a href="/?ms={m.id}&status=all" class="hover:underline"
						>{m.name} <span class="tabular-nums">{m.done}/{m.total}</span></a
					>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="text-zinc-400">
			No open milestones. Add one in <a href="/settings" class="underline">Settings</a> or with
			<code>^v1.0</code> in quick add.
		</p>
	{/if}
</section>

<div class="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
	<!-- Trend -->
	<section class="rounded border border-zinc-200 p-3 dark:border-zinc-800">
		{@render card('Last 8 weeks')}
		<TrendChart weeks={data.trend} />
		<p class="mt-1 text-xs text-zinc-500">
			{trendTotals.created} created · {trendTotals.closed} closed ·
			<span class={net > 0 ? 'text-amber-600 dark:text-amber-400' : ''}
				>backlog {net > 0 ? `grew by ${net}` : net < 0 ? `shrank by ${-net}` : 'flat'}</span
			>
		</p>
	</section>

	<!-- Shipped -->
	<section class="rounded border border-zinc-200 p-3 dark:border-zinc-800">
		{@render card(
			`Shipped this week · ${data.shipped.length}`,
			'/?status=closed&sort=updated',
			'closed in the last 7 days'
		)}
		{#if data.shipped.length}
			<ul class="divide-y divide-zinc-100 dark:divide-zinc-900">
				{#each data.shipped as i (i.id)}
					<li class="flex items-baseline gap-2 py-1">
						<span class="font-mono text-xs text-zinc-400">#{i.id}</span>
						<span class="w-14 shrink-0 text-xs {TYPE_CLASS[i.type]}">{TYPE_LABEL[i.type]}</span>
						<a href="/issues/{i.id}" class="min-w-0 truncate hover:underline">{i.title}</a>
						<span class="ml-auto shrink-0 text-xs text-zinc-500">{i.appName}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-zinc-400">Nothing closed in the last 7 days yet.</p>
		{/if}
	</section>
</div>

<!-- Apps + stale -->
<section class="mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
	<h2 class="text-xs font-medium tracking-wide text-zinc-500 uppercase">Apps</h2>
	{#each data.perApp as a (a.id)}
		<a href="/?app={encodeURIComponent(a.name)}" class="flex items-center gap-1.5 hover:underline">
			<span class="size-2 rounded-full" style="background:{a.color}"></span>
			{a.name}
			<span class="text-zinc-500 tabular-nums">{a.open} open</span>
			{#if a.bugs}<span class="text-xs text-zinc-400">· {a.bugs} bugs</span>{/if}
			{#if a.urgent}<span class="text-xs text-red-500">· {a.urgent} urgent</span>{/if}
		</a>
	{:else}
		<span class="text-zinc-400">No apps yet.</span>
	{/each}
	{#if f.stale}
		<a href="/?sort=updated&dir=asc" class="ml-auto text-xs text-zinc-500 hover:underline"
			>{f.stale} open issue{f.stale === 1 ? '' : 's'} untouched for 30+ days →</a
		>
	{/if}
</section>
