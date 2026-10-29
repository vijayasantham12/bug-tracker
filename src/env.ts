import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres connection string, e.g. postgres://user:pass@localhost:5432/bugtracker'
	},
	S3_BUCKET: {
		schema: optional,
		description: 'Bucket for attachments; attachments are disabled when unset'
	},
	S3_REGION: {
		schema: (v) => v || 'us-east-1',
		description: "Bucket region ('auto' for Cloudflare R2)"
	},
	S3_ENDPOINT: {
		schema: optional,
		description:
			'S3-compatible endpoint for R2/MinIO/B2 etc, e.g. https://<account>.r2.cloudflarestorage.com. Leave unset for AWS.'
	},
	S3_ACCESS_KEY_ID: { schema: optional },
	S3_SECRET_ACCESS_KEY: { schema: optional },
	S3_PREFIX: { schema: (v) => v ?? 'bug-tracker/', description: 'Key prefix inside the bucket' },
	VAPID_SUBJECT: {
		schema: (v) => v || 'mailto:admin@localhost',
		description:
			'Contact for Web Push services (mailto: or https: URL). The VAPID keys themselves are generated and stored in the database on first use.'
	},
	ATTACHMENT_MAX_MB: {
		schema: (v) => {
			const n = Number(v || 25);
			if (!(n > 0)) throw new Error('ATTACHMENT_MAX_MB must be a positive number');
			return n;
		}
	}
});
