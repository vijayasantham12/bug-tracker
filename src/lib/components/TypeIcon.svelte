<script lang="ts">
	import Bug from '~icons/octicon/bug-16';
	import Rocket from '~icons/octicon/rocket-16';
	import Zap from '~icons/octicon/zap-16';
	import Checkbox from '~icons/octicon/checkbox-16';
	import { TYPE_LABEL, type IssueType } from '#lib/types.ts';

	let { type, class: cls = '' }: { type: IssueType; class?: string } = $props();
	const ICONS = { bug: Bug, feature: Rocket, improvement: Zap, task: Checkbox };
	const Icon = $derived(ICONS[type]);
</script>

<Icon class="icon {cls}" aria-label={TYPE_LABEL[type]} role="img" />
