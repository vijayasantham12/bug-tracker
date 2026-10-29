import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TOOLS } from '#lib/server/mcp.ts';
import { requireUser } from '#lib/server/session.ts';

/**
 * Model Context Protocol over "streamable HTTP", stateless: every POST is one JSON-RPC message
 * answered with plain JSON (no sessions, no server-sent events). Auth is the usual API token:
 *   claude mcp add --transport http bugs https://<host>/api/mcp --header "Authorization: Bearer <token>"
 */

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const INSTRUCTIONS = `This is the user's own bug tracker. Issues are referred to as #123.
When asked about an issue, call get_issue first: it returns the description, comments, history and attachments (screenshots as images, logs as text).
After fixing something, offer to add_comment with the root cause and fix, or close_issue with that comment.`;

interface RpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
}

const reply = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: RpcRequest['id'], code: number, message: string) => ({
	jsonrpc: '2.0',
	id: id ?? null,
	error: { code, message }
});

async function handle(msg: RpcRequest, ctx: Parameters<(typeof TOOLS)[number]['run']>[1]) {
	const { id, method, params = {} } = msg;
	switch (method) {
		case 'initialize': {
			const asked = String(params.protocolVersion ?? '');
			return reply(id, {
				protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: 'bugs', version: '1.0.0' },
				instructions: INSTRUCTIONS
			});
		}
		case 'ping':
			return reply(id, {});
		case 'tools/list':
			return reply(id, {
				tools: TOOLS.map(({ name, description, inputSchema }) => ({
					name,
					description,
					inputSchema
				}))
			});
		case 'tools/call': {
			const tool = TOOLS.find((t) => t.name === params.name);
			if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
			try {
				const args = (params.arguments ?? {}) as Record<string, unknown>;
				return reply(id, { content: await tool.run(args, ctx) });
			} catch (e) {
				// bad input or a missing issue is a tool result the model can react to, not a protocol error
				if (isHttpError(e))
					return reply(id, { content: [{ type: 'text', text: e.body.message }], isError: true });
				console.error(`mcp ${tool.name}:`, e);
				return reply(id, {
					content: [{ type: 'text', text: `Failed: ${(e as Error).message}` }],
					isError: true
				});
			}
		}
		default:
			return fail(id, -32601, `Method not found: ${method}`);
	}
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const user = requireUser(locals);
	const body = (await request.json().catch(() => null)) as RpcRequest | RpcRequest[] | null;
	if (!body) return json(fail(null, -32700, 'Parse error'), { status: 400 });
	const ctx = { user, origin: url.origin };
	// notifications and responses (no id or no method) need no answer
	const isRequest = (m: RpcRequest) => m.method !== undefined && m.id !== undefined;
	if (Array.isArray(body)) {
		const out = await Promise.all(body.filter(isRequest).map((m) => handle(m, ctx)));
		return out.length ? json(out) : new Response(null, { status: 202 });
	}
	if (!isRequest(body)) return new Response(null, { status: 202 });
	return json(await handle(body, ctx));
};

// no server-initiated messages, so no event stream to open and no session to end
export const GET: RequestHandler = () =>
	new Response(null, { status: 405, headers: { allow: 'POST' } });
export const DELETE = GET;
