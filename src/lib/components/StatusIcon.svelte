<script lang="ts">
	import IssueOpened from '~icons/octicon/issue-opened-16';
	import IssueDraft from '~icons/octicon/issue-draft-16';
	import DotFill from '~icons/octicon/dot-fill-16';
	import Beaker from '~icons/octicon/beaker-16';
	import Blocked from '~icons/octicon/blocked-16';
	import IssueClosed from '~icons/octicon/issue-closed-16';
	import Skip from '~icons/octicon/skip-16';
	import { statusKind, type StatusKind } from '#lib/status.ts';
	import type { Status } from '#lib/types.ts';

	let {
		status,
		class: cls = ''
	}: {
		status: Pick<Status, 'name' | 'color' | 'isClosed' | 'isDefault'> | undefined;
		class?: string;
	} = $props();

	const ICONS: Record<StatusKind, typeof IssueOpened> = {
		open: IssueOpened,
		draft: IssueDraft,
		progress: DotFill,
		review: Beaker,
		blocked: Blocked,
		done: IssueClosed,
		skipped: Skip
	};
	const Icon = $derived(status ? ICONS[statusKind(status)] : IssueOpened);
</script>

<Icon
	class="icon {cls}"
	style={status ? `color:${status.color}` : undefined}
	role="img"
	aria-label={status?.name ?? 'Unknown status'}
/>
