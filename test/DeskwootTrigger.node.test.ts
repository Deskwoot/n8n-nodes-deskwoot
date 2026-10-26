import { createHmac } from 'crypto';
import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { DeskwootTrigger, isValidSignature } from '../nodes/DeskwootTrigger/DeskwootTrigger.node';
import { fakeApi, hookContext, webhookContext } from './helpers';

const node = new DeskwootTrigger();
const hooks = node.webhookMethods.default;

const PRODUCTION_URL = 'https://n8n.example.com/webhook/abc/webhook';

// Made at run time, so no secret shaped literal sits in the source.
const SIGNING_KEY = 'k'.repeat(64);
const OTHER_KEY = 'o'.repeat(64);

const sign = (body: Buffer, key: string) =>
	`sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

describe('Deskwoot Trigger description', () => {
	it('follows the trigger conventions', () => {
		expect(node.description.name).toBe('deskwootTrigger');
		expect(node.description.displayName).toContain('Trigger');
		expect(node.description.inputs).toEqual([]);
		expect(node.description.usableAsTool).toBeUndefined();
		expect(node.description.webhooks?.[0]).toMatchObject({ name: 'default', httpMethod: 'POST' });
	});

	it('says up front what the trigger needs', () => {
		const notice = node.description.properties.find((p) => p.type === 'notice');
		expect(notice?.displayName).toContain('HTTPS');
		expect(notice?.displayName).toContain('Enterprise plan');
		expect(notice?.displayName).toContain('administrator');
	});

	it("offers exactly Deskwoot's 6 REST hook triggers", () => {
		const event = node.description.properties.find((p) => p.name === 'event');
		const values = (event?.options as INodePropertyOptions[]).map((o) => o.value).sort();
		expect(values).toEqual([
			'contact.created',
			'conversation.assigned',
			'conversation.created',
			'conversation.resolved',
			'csat.submitted',
			'message.incoming',
		]);
	});
});

describe('subscribing', () => {
	it('subscribes the webhook URL to the event and keeps the ID and the secret', async () => {
		const api = fakeApi({
			'POST /accounts/acc_1/rest-hooks': {
				statusCode: 201,
				body: { id: 'h1', trigger: 'message.incoming', url: PRODUCTION_URL, secret: SIGNING_KEY },
			},
		});
		const staticData: IDataObject = {};
		const { ctx } = hookContext({
			api,
			staticData,
			webhookUrl: PRODUCTION_URL,
			event: 'message.incoming',
		});

		expect(await hooks.checkExists.call(ctx)).toBe(false);
		expect(await hooks.create.call(ctx)).toBe(true);
		expect(api.calls[0].body).toEqual({ url: PRODUCTION_URL, trigger: 'message.incoming' });
		expect(staticData).toEqual({ hookId: 'h1', secret: SIGNING_KEY });
		expect(await hooks.checkExists.call(ctx)).toBe(true);
	});

	it('removes the hook again and stops when Deskwoot sends no secret', async () => {
		const api = fakeApi({
			'POST /accounts/acc_1/rest-hooks': {
				statusCode: 201,
				body: { id: 'h3', trigger: 'conversation.created' },
			},
			'DELETE /accounts/acc_1/rest-hooks/h3': { statusCode: 200, body: { deleted: true } },
		});
		const staticData: IDataObject = {};
		const { ctx } = hookContext({ api, staticData, webhookUrl: PRODUCTION_URL });

		const error = await hooks.create.call(ctx).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toContain('signing secret');
		expect(api.calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
		expect(staticData).toEqual({});
	});

	it('stops when Deskwoot sends no ID', async () => {
		const api = fakeApi({ 'POST /accounts/acc_1/rest-hooks': { statusCode: 201, body: {} } });
		const { ctx } = hookContext({ api, staticData: {}, webhookUrl: PRODUCTION_URL });
		await expect(hooks.create.call(ctx)).rejects.toThrow('did not return an ID');
	});

	it("passes on Deskwoot's refusal, such as a URL that is not public", async () => {
		const api = fakeApi({
			'POST /accounts/acc_1/rest-hooks': {
				statusCode: 400,
				body: { error: 'url must be a public HTTPS address', code: 'invalid_url' },
			},
		});
		const { ctx } = hookContext({
			api,
			staticData: {},
			webhookUrl: 'http://localhost:5678/webhook/x',
		});
		await expect(hooks.create.call(ctx)).rejects.toThrow('url must be a public HTTPS address');
	});
});

describe('unsubscribing', () => {
	it('removes the hook and forgets it, also when Deskwoot removed it already', async () => {
		const api = fakeApi({
			'DELETE /accounts/acc_1/rest-hooks/h1': { statusCode: 200, body: { deleted: false } },
		});
		const staticData: IDataObject = { hookId: 'h1', secret: SIGNING_KEY };
		const { ctx } = hookContext({ api, staticData, webhookUrl: PRODUCTION_URL });

		expect(await hooks.delete.call(ctx)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('does nothing without a stored hook', async () => {
		const api = fakeApi({});
		const { ctx } = hookContext({ api, staticData: {}, webhookUrl: PRODUCTION_URL });
		expect(await hooks.delete.call(ctx)).toBe(true);
		expect(api.calls).toHaveLength(0);
	});

	it('logs a removal without any answer, without the secret, and keeps the hook', async () => {
		const api = fakeApi({ 'DELETE /accounts/acc_1/rest-hooks/h1': new Error('socket hang up') });
		const staticData: IDataObject = { hookId: 'h1', secret: SIGNING_KEY };
		const { ctx, logger } = hookContext({ api, staticData, webhookUrl: PRODUCTION_URL });

		expect(await hooks.delete.call(ctx)).toBe(false);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SIGNING_KEY);
		expect(staticData).toEqual({ hookId: 'h1', secret: SIGNING_KEY });
		// The next publish uses the hook Deskwoot still has.
		expect(await hooks.checkExists.call(ctx)).toBe(true);
	});

	it.each([403, 500])('keeps the hook when Deskwoot answers %i', async (statusCode) => {
		const api = fakeApi({
			'DELETE /accounts/acc_1/rest-hooks/h1': {
				statusCode,
				body: { error: 'API access requires an Enterprise plan.' },
			},
		});
		const staticData: IDataObject = { hookId: 'h1', secret: SIGNING_KEY };
		const { ctx, logger } = hookContext({ api, staticData, webhookUrl: PRODUCTION_URL });

		expect(await hooks.delete.call(ctx)).toBe(false);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(staticData).toEqual({ hookId: 'h1', secret: SIGNING_KEY });
	});

	it('forgets the hook after a 401, since revoking the token removed it', async () => {
		const api = fakeApi({
			'DELETE /accounts/acc_1/rest-hooks/h1': { statusCode: 401, body: { error: 'Unauthorized' } },
		});
		const staticData: IDataObject = { hookId: 'h1', secret: SIGNING_KEY };
		const { ctx } = hookContext({ api, staticData, webhookUrl: PRODUCTION_URL });

		expect(await hooks.delete.call(ctx)).toBe(true);
		expect(staticData).toEqual({});
	});
});

describe('receiving', () => {
	const event = {
		id: 'cv1',
		trigger: 'conversation.created',
		occurredAt: '2026-10-16T09:12:00.000Z',
	};
	const raw = Buffer.from(JSON.stringify(event));
	const stored = (): IDataObject => ({ hookId: 'h1', secret: SIGNING_KEY });

	it('starts the workflow with the delivered object when the signature matches', async () => {
		const { ctx, response } = webhookContext({
			staticData: stored(),
			rawBody: raw,
			headers: { 'x-deskwoot-signature': sign(raw, SIGNING_KEY) },
			body: event,
		});
		expect(await node.webhook.call(ctx)).toEqual({ workflowData: [[{ json: event }]] });
		expect(response.statusCode).toBe(0);
	});

	it('signs the raw bytes, so a body with umlauts and an emoji passes', async () => {
		const umlauts = {
			id: 'cv2',
			trigger: 'message.incoming',
			content: 'Grüße aus Köln, die Bestellung ist noch nicht da 😕',
		};
		// The bytes as Deskwoot sends them: UTF-8, more bytes than characters.
		const bytes = Buffer.from(JSON.stringify(umlauts), 'utf8');
		expect(bytes.length).toBeGreaterThan(JSON.stringify(umlauts).length);
		const { ctx, response } = webhookContext({
			staticData: stored(),
			rawBody: bytes,
			headers: { 'x-deskwoot-signature': sign(bytes, SIGNING_KEY) },
			body: umlauts,
		});
		expect(await node.webhook.call(ctx)).toEqual({ workflowData: [[{ json: umlauts }]] });
		expect(response.statusCode).toBe(0);
		// Signed over the same text read as Latin-1, the signature no longer matches.
		const latin1 = Buffer.from(JSON.stringify(umlauts), 'latin1');
		expect(isValidSignature(latin1, sign(bytes, SIGNING_KEY), SIGNING_KEY)).toBe(false);
	});

	it('reads the raw body when n8n has not read it yet', async () => {
		const { ctx } = webhookContext({
			staticData: stored(),
			readRawBody: raw,
			headers: { 'x-deskwoot-signature': sign(raw, SIGNING_KEY) },
			body: event,
		});
		expect((await node.webhook.call(ctx)).workflowData).toBeDefined();
	});

	const refused: Array<[string, () => Parameters<typeof webhookContext>[0]]> = [
		[
			'a wrong signature',
			() => ({
				staticData: stored(),
				rawBody: raw,
				headers: { 'x-deskwoot-signature': sign(raw, OTHER_KEY) },
				body: event,
			}),
		],
		['no signature', () => ({ staticData: stored(), rawBody: raw, headers: {}, body: event })],
		[
			'a changed body',
			() => ({
				staticData: stored(),
				rawBody: Buffer.from(`${raw.toString()} `),
				headers: { 'x-deskwoot-signature': sign(raw, SIGNING_KEY) },
				body: event,
			}),
		],
		[
			'a signature without its prefix',
			() => ({
				staticData: stored(),
				rawBody: raw,
				headers: { 'x-deskwoot-signature': sign(raw, SIGNING_KEY).slice(7) },
				body: event,
			}),
		],
		[
			'no stored secret',
			() => ({
				staticData: {},
				rawBody: raw,
				headers: { 'x-deskwoot-signature': sign(raw, SIGNING_KEY) },
				body: event,
			}),
		],
		[
			'no raw body',
			() => ({
				staticData: stored(),
				headers: { 'x-deskwoot-signature': sign(raw, SIGNING_KEY) },
				body: event,
			}),
		],
	];

	it.each(refused)('answers 401 and starts nothing for %s', async (_label, options) => {
		const { ctx, response } = webhookContext(options());
		expect(await node.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
		expect(response.sent).toEqual({ error: 'Invalid signature' });
	});
});

describe('isValidSignature', () => {
	it('compares only same length hex digests', () => {
		const body = Buffer.from('{}');
		expect(isValidSignature(body, sign(body, SIGNING_KEY), SIGNING_KEY)).toBe(true);
		expect(isValidSignature(body, 'sha256=abc', SIGNING_KEY)).toBe(false);
		expect(isValidSignature(body, ['sha256=abc'], SIGNING_KEY)).toBe(false);
	});
});
