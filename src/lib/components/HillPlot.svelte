<script lang="ts">
	import { HILL_PATH, hillPhase, hillPoint } from '#lib/hill.ts';
	import type { HillScope } from '#lib/types.ts';

	let {
		scopes,
		selectedId = null,
		onmove,
		onselect,
		label = 'Hill Chart'
	}: {
		scopes: HillScope[];
		selectedId?: number | null;
		onmove?: (id: number, position: number) => void;
		onselect?: (id: number) => void;
		label?: string;
	} = $props();
	let svg: SVGSVGElement;
	let dragging = $state<number | null>(null);
	const ordered = $derived(
		[...scopes].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))
	);

	function move(event: PointerEvent) {
		if (dragging === null || !onmove) return;
		const matrix = svg.getScreenCTM();
		if (!matrix) return;
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		onmove(dragging, Math.max(0, Math.min(100, Math.round((point.x - 40) / 7.2))));
	}

	function start(event: PointerEvent, id: number) {
		if (!onmove || event.button !== 0) return;
		event.preventDefault();
		dragging = id;
		onselect?.(id);
		(event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
		(event.currentTarget as SVGElement).focus();
	}

	function keydown(event: KeyboardEvent, scope: HillScope) {
		if (!onmove) return;
		const step = event.shiftKey ? 10 : 1;
		const positions: Record<string, number> = {
			ArrowLeft: scope.position - step,
			ArrowDown: scope.position - step,
			ArrowRight: scope.position + step,
			ArrowUp: scope.position + step,
			Home: 0,
			End: 100
		};
		if (!(event.key in positions)) return;
		event.preventDefault();
		onselect?.(scope.id);
		onmove(scope.id, Math.max(0, Math.min(100, positions[event.key])));
	}
</script>

<svg
	bind:this={svg}
	viewBox="0 0 800 215"
	class="block w-full overflow-visible"
	role="group"
	aria-label={label}
>
	<path d="{HILL_PATH} L760,205 L40,205 Z" class="fill-zinc-50 dark:fill-zinc-900/50" />
	<path d={HILL_PATH} fill="none" class="stroke-zinc-400 dark:stroke-zinc-500" stroke-width="2.5" />
	<line
		x1="400"
		y1="26"
		x2="400"
		y2="205"
		class="stroke-zinc-300 dark:stroke-zinc-700"
		stroke-dasharray="4 5"
	/>
	<line x1="40" y1="205" x2="760" y2="205" class="stroke-zinc-200 dark:stroke-zinc-800" />
	{#each ordered as scope (scope.id)}
		{@const point = hillPoint(scope.position)}
		{@const selected = scope.id === selectedId}
		{@const labelY =
			Math.min(
				...scopes
					.filter((s) => Math.abs(s.position - scope.position) < 20)
					.map((s) => hillPoint(s.position).y)
			) - 25}
		<g
			role="slider"
			tabindex={onmove ? 0 : undefined}
			aria-label={scope.name}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={scope.position}
			aria-valuetext={hillPhase(scope.position)}
			aria-disabled={!onmove}
			class="dot outline-none {onmove ? 'cursor-grab touch-none active:cursor-grabbing' : ''}"
			onpointerdown={(e) => start(e, scope.id)}
			onpointermove={move}
			onpointerup={() => (dragging = null)}
			onpointercancel={() => (dragging = null)}
			onlostpointercapture={() => (dragging = null)}
			onkeydown={(e) => keydown(e, scope)}
			onfocus={() => onselect?.(scope.id)}
		>
			<title>{scope.name} · {hillPhase(scope.position)}</title>
			<circle cx={point.x} cy={point.y} r="22" fill="transparent" />
			<circle
				class="ring"
				cx={point.x}
				cy={point.y}
				r="17"
				fill="none"
				stroke={scope.color}
				stroke-width="2"
				opacity={selected ? 0.45 : 0}
			/>
			<circle cx={point.x} cy={point.y} r="12" fill={scope.color} stroke="white" stroke-width="2" />
			<text
				x={point.x}
				y={point.y + 4}
				text-anchor="middle"
				fill="white"
				class="pointer-events-none text-[11px] font-semibold"
				>{scopes.findIndex((s) => s.id === scope.id) + 1}</text
			>
			{#if selected}
				<text
					x={point.x}
					y={labelY}
					text-anchor={scope.position < 15 ? 'start' : scope.position > 85 ? 'end' : 'middle'}
					class="pointer-events-none fill-zinc-800 text-[13px] font-medium dark:fill-zinc-200"
					>{scope.name.length > 34 ? `${scope.name.slice(0, 32)}…` : scope.name}</text
				>
			{/if}
		</g>
	{/each}
</svg>

<div class="mb-4 flex justify-between gap-4 px-[5%] text-xs text-zinc-500">
	<span>Figuring things out</span><span class="text-right">Making it happen</span>
</div>

<style>
	.dot:focus-visible .ring {
		opacity: 1;
		stroke-width: 3;
	}
</style>
