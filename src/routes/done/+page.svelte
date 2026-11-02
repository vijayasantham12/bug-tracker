<script lang="ts">
	import Copy from '~icons/octicon/copy-16';
	import TypeIcon from '#lib/components/TypeIcon.svelte';
	import StatusIcon from '#lib/components/StatusIcon.svelte';
	import { isShipped } from '#lib/status.ts';
	import { goto } from '$app/navigation';
	import { dayLabel, groupDone, weekMarkdown } from '#lib/done.ts';
	import { fullDate, TYPE_CLASS } from '#lib/format.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import { TYPE_LABEL } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const statusById = $derived(new Map(data.statuses.map((s) => [s.id, s])));
	// Closed statuses like "Won't Fix" or "Duplicate" are shown but not counted as shipped.
	const shipped = (statusId: number) => isShipped(statusById.get(statusId));

	const weeks = $derived(groupDone(data.issues, data.today));
	const shippedIssues = $derived(data.issues.filter((i) => shipped(i.statusId)));
	const counts = $derived(
		(['bug', 'feature', 'improvement', 'task'] as const)
			.map((t) => [t, shippedIssues.filter((i) => i.type === t).length] as const)
			.filter(([, n]) => n)
	);

	function href(params: { weeks?: number; app?: string | null }) {
		const w = params.weeks ?? data.weeks;
		const app = params.app === undefined ? data.app : params.app;
		const q = [w !== 4 && `weeks=${w}`, app && `app=${encodeURIComponent(app)}`].filter(Boolean);
		return q.length ? `/done?${q.join('&')}` : '/done';
	}

	function copyWeek(week: (typeof weeks)[number]) {
		navigator.clipboard?.writeText(weekMarkdown(week, (i) => shipped(i.statusId))).then(
			() => notify(`Copied ${week.label.toLowerCase()} as Markdown`),
			() => {}
		);
	}
</script>

<svelte:head><title>Done · Bugs</title></svelte:head>

<div class="mb-4 flex flex-wrap items-end gap-3">
	<div class="min-w-0 flex-1">
		<h1 class="text-lg font-semibold">
			Done <span class="text-sm font-normal text-zinc-500"
				>· {shippedIssues.length} shipped in {data.weeks === 1
					? 'this week'
					: `${data.weeks} weeks`}</span
			>
		</h1>
		{#if counts.length}
			<p class="mt-1 flex flex-wrap gap-3 text-sm">
				{#each counts as [type, n] (type)}
					<span class={TYPE_CLASS[type]}
						>{n} {TYPE_LABEL[type].toLowerCase()}{n === 1 ? '' : 's'}</span
					>
				{/each}
			</p>
		{/if}
	</div>
	<select
		class="input"
		aria-label="App"
		value={data.app ?? ''}
		onchange={(e) => goto(href({ app: e.currentTarget.value || null }))}
	>
		<option value="">All apps</option>
		{#each data.apps as a (a.id)}<option value={a.name}>{a.name}</option>{/each}
	</select>
</div>

{#if weeks.length}
	<div class="space-y-6">
		{#each weeks as week (week.start)}
			<section aria-labelledby="week-{week.start}">
				<div
					class="mb-2 flex items-baseline gap-2 border-b border-zinc-200 pb-1 dark:border-zinc-800"
				>
					<h2 id="week-{week.start}" class="font-medium">{week.label}</h2>
					<span class="text-xs text-zinc-500">{week.count}</span>
					<button
						class="ml-auto text-xs text-zinc-500 hover:underline"
						title="Copy this week as release notes"
						onclick={() => copyWeek(week)}><Copy aria-hidden="true" /> Copy Markdown</button
					>
				</div>
				{#each week.days as day (day.day)}
					<h3 class="mt-3 mb-1 text-xs font-medium text-zinc-500">
						{dayLabel(day.day, data.today)}
					</h3>
					<ul>
						{#each day.issues as i (i.id)}
							{@const st = statusById.get(i.statusId)}
							{@const ok = shipped(i.statusId)}
							<li class="flex items-baseline gap-2 py-1 {ok ? '' : 'opacity-60'}">
								<StatusIcon status={st} class="shrink-0 self-center" />
								<span class="w-10 shrink-0 text-xs text-zinc-400">#{i.id}</span>
								<span class="shrink-0 text-xs {TYPE_CLASS[i.type]}" title={TYPE_LABEL[i.type]}
									><TypeIcon type={i.type} /></span
								>
								<a
									href="/issues/{i.id}"
									class="min-w-0 truncate hover:underline {ok ? '' : 'line-through'}"
									title={i.closedAt ? `Closed ${fullDate(i.closedAt)}` : undefined}>{i.title}</a
								>
								<span class="ml-auto flex shrink-0 items-baseline gap-2 text-xs">
									{#if !ok && st}<span style="color:{st.color}">{st.name}</span>{/if}
									{#if i.fixedIn}<span class="text-zinc-400">{i.fixedIn}</span>{/if}
									<span class="flex items-center gap-1 text-zinc-500"
										><span class="size-1.5 rounded-full" style="background:{i.appColor}"
										></span>{i.appName}</span
									>
								</span>
							</li>
						{/each}
					</ul>
				{/each}
			</section>
		{/each}
	</div>
{:else}
	<p
		class="rounded border border-dashed border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800"
	>
		Nothing closed {data.weeks === 1 ? 'this week' : `in the last ${data.weeks} weeks`}{data.app
			? ` in ${data.app}`
			: ''}.
	</p>
{/if}

{#if data.hasOlder && data.weeks < data.maxWeeks}
	<nav class="mt-6 text-sm">
		<a
			class="hover:underline"
			href={href({ weeks: Math.min(data.weeks + 4, data.maxWeeks) })}
			data-sveltekit-noscroll>Show 4 more weeks →</a
		>
	</nav>
{:else if data.hasOlder}
	<p class="mt-6 text-sm text-zinc-500">
		Older work: <a class="hover:underline" href="/?status=closed">all closed issues</a>
	</p>
{/if}
