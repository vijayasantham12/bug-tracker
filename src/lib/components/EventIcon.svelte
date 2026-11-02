<script lang="ts">
	import StatusIcon from './StatusIcon.svelte';
	import TypeIcon from './TypeIcon.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import IssueOpened from '~icons/octicon/issue-opened-16';
	import IssueReopened from '~icons/octicon/issue-reopened-16';
	import CommentDiscussion from '~icons/octicon/comment-discussion-16';
	import Pencil from '~icons/octicon/pencil-16';
	import Trash from '~icons/octicon/trash-16';
	import Undo from '~icons/octicon/undo-16';
	import Repo from '~icons/octicon/repo-16';
	import Milestone from '~icons/octicon/milestone-16';
	import Tag from '~icons/octicon/tag-16';
	import Versions from '~icons/octicon/versions-16';
	import GitMerge from '~icons/octicon/git-merge-16';
	import Calendar from '~icons/octicon/calendar-16';
	import IssueTrackedBy from '~icons/octicon/issue-tracked-by-16';
	import Stack from '~icons/octicon/stack-16';
	import Alert from '~icons/octicon/alert-16';
	import Server from '~icons/octicon/server-16';
	import Sync from '~icons/octicon/sync-16';
	import Paperclip from '~icons/octicon/paperclip-16';
	import Link from '~icons/octicon/link-16';
	import IssueRelatesTo from '~icons/octicon/issue-relates-to-16';
	import Dot from '~icons/octicon/dot-fill-16';
	import { PRIORITIES, TYPES, type IssueEvent, type IssueType, type Status } from '#lib/types.ts';
	import { TYPE_CLASS } from '#lib/format.ts';

	/** `created` is the synthetic first entry; otherwise an event from issue_events. */
	let {
		ev,
		statuses
	}: {
		ev: Pick<IssueEvent, 'kind' | 'field' | 'oldValue' | 'newValue'> | 'created';
		statuses: Status[];
	} = $props();

	const GRAY = 'text-zinc-400 dark:text-zinc-500';
	const FIELD_ICONS: Record<string, typeof Pencil> = {
		title: Pencil,
		description: Pencil,
		'where I stopped': Pencil,
		'next action': Pencil,
		app: Repo,
		milestone: Milestone,
		labels: Tag,
		version: Versions,
		'fixed in': GitMerge,
		due: Calendar,
		parent: IssueTrackedBy,
		size: Stack,
		severity: Alert,
		environment: Server,
		repeat: Sync,
		attachment: Paperclip,
		link: Link,
		relation: IssueRelatesTo
	};

	const byName = (name: string | null) => statuses.find((s) => s.name === name);
	const newStatus = $derived(
		typeof ev === 'object' && ev.field === 'status' ? byName(ev.newValue) : undefined
	);
	const reopened = $derived(
		typeof ev === 'object' && !!newStatus && !newStatus.isClosed && !!byName(ev.oldValue)?.isClosed
	);
	const priority = $derived(
		typeof ev === 'object' && ev.field === 'priority'
			? PRIORITIES.findIndex((p) => p.label === ev.newValue)
			: -1
	);
	const type = $derived(
		typeof ev === 'object' && ev.field === 'type' && TYPES.includes(ev.newValue as IssueType)
			? (ev.newValue as IssueType)
			: null
	);
	const Field = $derived(typeof ev === 'object' ? FIELD_ICONS[ev.field ?? ''] : undefined);
</script>

{#if ev === 'created'}
	<IssueOpened class="icon text-green-600 dark:text-green-400" aria-hidden="true" />
{:else if ev.kind === 'comment'}
	<CommentDiscussion class="icon {GRAY}" aria-hidden="true" />
{:else if reopened}
	<IssueReopened class="icon text-green-600 dark:text-green-400" aria-hidden="true" />
{:else if newStatus}
	<StatusIcon status={newStatus} />
{:else if ev.field === 'trash'}
	{#if ev.newValue === 'Restored'}
		<Undo class="icon {GRAY}" aria-hidden="true" />
	{:else}
		<Trash class="icon text-red-500" aria-hidden="true" />
	{/if}
{:else if priority >= 0}
	<PriorityIcon {priority} />
{:else if type}
	<TypeIcon {type} class={TYPE_CLASS[type]} />
{:else if Field}
	<Field class="icon {GRAY}" aria-hidden="true" />
{:else}
	<Dot class="icon {GRAY}" aria-hidden="true" />
{/if}
