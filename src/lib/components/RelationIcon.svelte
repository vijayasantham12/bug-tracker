<script lang="ts">
	import IssueRelatesTo from '~icons/octicon/issue-relates-to-16';
	import Blocked from '~icons/octicon/blocked-16';
	import Stop from '~icons/octicon/stop-16';
	import Duplicate from '~icons/octicon/duplicate-16';
	import LinkExternal from '~icons/octicon/link-external-16';
	import type { RelationKind } from '#lib/types.ts';

	let { kind, class: cls = '' }: { kind: RelationKind | 'link'; class?: string } = $props();
	const ICONS = {
		relates: IssueRelatesTo,
		blocks: Stop,
		blocked_by: Blocked,
		duplicates: Duplicate,
		duplicated_by: Duplicate,
		link: LinkExternal
	};
	const Icon = $derived(ICONS[kind]);
</script>

<Icon class="icon {cls}" aria-hidden="true" />
