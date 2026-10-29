<script lang="ts">
	/** Created vs closed per week: grouped bars, one axis, hover tooltip per week. */
	let { weeks }: { weeks: { week: string; created: number; closed: number }[] } = $props();

	// drawn at the real pixel width so text and bars keep their size
	let W = $state(320);
	const H = 140;
	const PAD = { top: 14, bottom: 18 };
	const BAR = 9;
	const GAP = 2; // surface gap between the paired bars

	const max = $derived(Math.max(1, ...weeks.flatMap((w) => [w.created, w.closed])));
	const slot = $derived(W / weeks.length);
	const y = (v: number) => ((H - PAD.top - PAD.bottom) * v) / max;
	const base = H - PAD.bottom;
	const label = (week: string) =>
		new Date(`${week}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

	let hover = $state<number | null>(null);
	const last = $derived(weeks.length - 1);

	/** Bar with a 4px rounded top and a square foot on the baseline. */
	function bar(x: number, h: number) {
		if (h <= 0) return '';
		const r = Math.min(4, h, BAR / 2);
		return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + BAR - r} Q${x + BAR},${base - h} ${x + BAR},${base - h + r} V${base} Z`;
	}
</script>

<div class="trend">
	<div class="mb-1 flex items-center gap-3 text-xs text-zinc-500">
		<span class="flex items-center gap-1"
			><span class="size-2 rounded-sm" style="background:var(--series-1)"></span>Created</span
		>
		<span class="flex items-center gap-1"
			><span class="size-2 rounded-sm" style="background:var(--series-2)"></span>Closed</span
		>
	</div>
	<div class="relative" bind:clientWidth={W}>
		<svg
			viewBox="0 0 {W} {H}"
			width={W}
			height={H}
			class="block"
			role="img"
			aria-label="Issues created and closed per week, last {weeks.length} weeks: {weeks
				.map((w) => `${label(w.week)} ${w.created} created, ${w.closed} closed`)
				.join('; ')}"
		>
			<line x1="0" x2={W} y1={base} y2={base} class="stroke-zinc-200 dark:stroke-zinc-800" />
			{#each weeks as w, i (w.week)}
				{@const x = i * slot + (slot - (2 * BAR + GAP)) / 2}
				<g
					role="presentation"
					onmouseenter={() => (hover = i)}
					onmouseleave={() => (hover = null)}
					class={hover !== null && hover !== i ? 'opacity-40' : ''}
				>
					<!-- hit target: the whole week column -->
					<rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
					<path d={bar(x, y(w.created))} style="fill:var(--series-1)" />
					<path d={bar(x + BAR + GAP, y(w.closed))} style="fill:var(--series-2)" />
					{#if i === last}
						<!-- direct labels on the latest week only -->
						<text
							x={x + BAR / 2}
							y={base - y(w.created) - 3}
							text-anchor="middle"
							class="fill-zinc-500 text-[11px] tabular-nums">{w.created}</text
						>
						<text
							x={x + BAR + GAP + BAR / 2}
							y={base - y(w.closed) - 3}
							text-anchor="middle"
							class="fill-zinc-500 text-[11px] tabular-nums">{w.closed}</text
						>
					{/if}
					{#if i === 0 || i === last}
						<!-- end labels hug the edges so they never clip -->
						<text
							x={i === last ? W : 0}
							y={H - 4}
							text-anchor={i === last ? 'end' : 'start'}
							class="fill-zinc-400 text-[11px]">{i === last ? 'this week' : label(w.week)}</text
						>
					{/if}
				</g>
			{/each}
		</svg>
		{#if hover !== null}
			{@const w = weeks[hover]}
			<div
				class="pointer-events-none absolute top-0 rounded border border-zinc-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
				style="left:{((hover + 0.5) / weeks.length) * 100}%; transform:translateX({hover >
				weeks.length / 2
					? '-105%'
					: '5%'})"
			>
				<div class="text-zinc-500">Week of {label(w.week)}</div>
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-sm" style="background:var(--series-1)"></span>
					<span class="tabular-nums">{w.created}</span> created
				</div>
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-sm" style="background:var(--series-2)"></span>
					<span class="tabular-nums">{w.closed}</span> closed
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* categorical slots 1–2 of the validated default palette, stepped per mode */
	.trend {
		--series-1: #2a78d6;
		--series-2: #eb6834;
	}
	@media (prefers-color-scheme: dark) {
		.trend {
			--series-1: #3987e5;
			--series-2: #d95926;
		}
	}
</style>
