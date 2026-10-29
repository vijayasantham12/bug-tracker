<script lang="ts">
	import { renderMarkdown } from '#lib/markdown.ts';

	let { source, class: cls = '' }: { source: string; class?: string } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it escapes raw HTML and unsafe links -->
<div class="markdown {cls}">{@html renderMarkdown(source)}</div>
