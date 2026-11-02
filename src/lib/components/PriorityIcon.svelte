<script lang="ts">
	import Flame from '~icons/octicon/flame-16';
	import ArrowUp from '~icons/octicon/arrow-up-16';
	import Dash from '~icons/octicon/dash-16';
	import ArrowDown from '~icons/octicon/arrow-down-16';
	import { PRIORITY_CLASS } from '#lib/format.ts';
	import { PRIORITIES } from '#lib/types.ts';

	let { priority, class: cls = '' }: { priority: number; class?: string } = $props();
	// 0 urgent, 1 high, 2 normal, 3 low
	const ICONS = [Flame, ArrowUp, Dash, ArrowDown];
	const Icon = $derived(ICONS[priority] ?? Dash);
</script>

<Icon
	class="icon {PRIORITY_CLASS[priority]} {cls}"
	role="img"
	aria-label="{PRIORITIES[priority]?.label ?? 'Unknown'} priority"
/>
