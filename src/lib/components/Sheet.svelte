<script lang="ts">
	// A bottom sheet on phones (slides up, drag the handle down to dismiss, sits above the keyboard),
	// a centered dialog from `md` up.
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';

	let {
		label,
		onclose,
		children,
		width = 'md:max-w-2xl'
	}: { label: string; onclose: () => void; children: Snippet; width?: string } = $props();

	let panel = $state<HTMLDivElement>();
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	let startT = 0;

	function down(e: PointerEvent) {
		if (e.pointerType === 'mouse') return;
		dragging = true;
		startY = e.clientY;
		startT = e.timeStamp;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (dragging) dragY = Math.max(0, e.clientY - startY);
	}
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		const speed = dragY / Math.max(1, e.timeStamp - startT);
		if (dragY > 120 || (dragY > 30 && speed > 0.5)) onclose();
		else dragY = 0;
	}

	onMount(() => {
		const root = document.documentElement;
		const prev = root.style.overflow;
		root.style.overflow = 'hidden';
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !e.defaultPrevented) {
				e.preventDefault();
				onclose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			root.style.overflow = prev;
			window.removeEventListener('keydown', onKey);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="sheet-backdrop fixed inset-0 z-50 bg-zinc-950/40 md:flex md:items-start md:justify-center md:px-4 md:pt-[15vh]"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div
		bind:this={panel}
		role="dialog"
		aria-modal="true"
		aria-label={label}
		class="sheet-panel fixed inset-x-0 bottom-(--kb) flex max-h-[min(85dvh,calc(100dvh-var(--kb)-env(safe-area-inset-top)-1rem))] flex-col rounded-t-2xl bg-white shadow-2xl md:static md:max-h-[70vh] md:w-full md:rounded-lg dark:bg-zinc-950 {width}"
		style:transform={dragY ? `translateY(${dragY}px)` : undefined}
		style:transition={dragging ? 'none' : undefined}
	>
		<div
			class="flex shrink-0 touch-none justify-center pt-2 pb-1 md:hidden"
			aria-hidden="true"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		>
			<span class="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
		</div>
		<div
			class="min-h-0 overflow-y-auto overscroll-contain px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-3"
		>
			{@render children()}
		</div>
	</div>
</div>
