<script lang="ts">
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<AuthCard title="Sign in">
	<form method="POST" class="space-y-3">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			name="email"
			type="email"
			placeholder="Email"
			value={form?.email ?? ''}
			required
			autofocus
			class="input w-full"
			autocomplete="username"
		/>
		<input
			name="password"
			type="password"
			placeholder="Password"
			required
			class="input w-full"
			autocomplete="current-password"
		/>
		{#if form?.message}<p class="text-sm text-red-600">{form.message}</p>{/if}
		<button class="btn-primary w-full py-1.5">Sign in</button>
	</form>
</AuthCard>
