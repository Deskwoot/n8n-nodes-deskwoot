import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	accountPath,
	deskwootRequest,
	deskwootRequestFull,
	ENTERPRISE_MESSAGE,
	searchContacts,
	UNAUTHORIZED_MESSAGE,
} from '../nodes/Deskwoot/shared/transport';
import { BASE_URL, executeContext, fakeApi } from './helpers';

const ctxWith = (api: ReturnType<typeof fakeApi>, credentials?: Record<string, string>) =>
	executeContext({ api, params: {}, credentials });

describe('deskwootRequest', () => {
	it('calls the base URL without its trailing slash, through the Deskwoot credential', async () => {
		const api = fakeApi({ 'GET /me': { statusCode: 200, body: { accountId: 'acc_1' } } });
		const body = await deskwootRequest(ctxWith(api), 'GET', '/me');

		expect(body).toEqual({ accountId: 'acc_1' });
		expect(api.calls).toHaveLength(1);
		const [call] = api.calls;
		expect(call.credentialType).toBe('deskwootApi');
		expect(call.url).toBe(`${BASE_URL}/api/v1/me`);
		expect(call.options).toMatchObject({
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
		// n8n adds the token from the credential; the node never sets it itself.
		expect(JSON.stringify(call.options.headers ?? {})).not.toContain('Authorization');
	});

	it('falls back to deskwoot.com when the base URL is empty', async () => {
		const api = fakeApi({});
		await deskwootRequest(
			ctxWith(api, { baseUrl: '  ', apiToken: 't', accountId: 'acc_1' }),
			'GET',
			'/me',
		).catch(() => undefined);
		expect(api.calls[0].url).toBe('https://deskwoot.com/api/v1/me');
	});

	it('builds account paths with the account ID encoded and trimmed', async () => {
		const api = fakeApi({});
		const path = await accountPath(
			ctxWith(api, { baseUrl: BASE_URL, apiToken: 't', accountId: ' acc/1 ' }),
			'/inboxes',
		);
		expect(path).toBe('/accounts/acc%2F1/inboxes');
	});

	it('explains a 403 about the Enterprise plan', async () => {
		const api = fakeApi({
			'GET /me': {
				statusCode: 403,
				body: {
					error: 'API access requires an Enterprise plan. Please upgrade at /settings/billing',
				},
			},
		});
		const error = await deskwootRequest(ctxWith(api), 'GET', '/me').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toBe(ENTERPRISE_MESSAGE);
		expect((error as NodeApiError).httpCode).toBe('403');
	});

	it('explains a 401', async () => {
		const api = fakeApi({ 'GET /me': { statusCode: 401, body: { error: 'Unauthorized' } } });
		const error = await deskwootRequest(ctxWith(api), 'GET', '/me').catch((e: unknown) => e);
		expect((error as NodeApiError).message).toBe(UNAUTHORIZED_MESSAGE);
		expect((error as NodeApiError).httpCode).toBe('401');
	});

	it("passes on Deskwoot's own error text and code for other answers", async () => {
		const api = fakeApi({
			'POST /accounts/acc_1/rest-hooks': {
				statusCode: 403,
				body: {
					error: 'Only an API token of an administrator can turn on Deskwoot triggers',
					code: 'administrator_token_required',
				},
			},
		});
		const error = await deskwootRequest(
			ctxWith(api),
			'POST',
			'/accounts/acc_1/rest-hooks',
			{},
			undefined,
			2,
		).catch((e: unknown) => e);
		expect((error as NodeApiError).message).toBe(
			'Only an API token of an administrator can turn on Deskwoot triggers',
		);
		expect((error as NodeApiError).description).toBe(
			'Deskwoot error code: administrator_token_required',
		);
		expect((error as NodeApiError).context.itemIndex).toBe(2);
	});

	it('names the status when the answer has no error text', async () => {
		const api = fakeApi({ 'GET /me': { statusCode: 502, body: '<html>Bad gateway</html>' } });
		const error = await deskwootRequest(ctxWith(api), 'GET', '/me').catch((e: unknown) => e);
		expect((error as NodeApiError).message).toBe('Deskwoot answered with status 502');
	});

	it('lets an error of a request without any answer through', async () => {
		const api = fakeApi({ 'GET /me': new Error('getaddrinfo ENOTFOUND deskwoot.example') });
		await expect(deskwootRequest(ctxWith(api), 'GET', '/me')).rejects.toThrow('ENOTFOUND');
	});

	it('returns any status unthrown in the full variant', async () => {
		const api = fakeApi({
			'POST /accounts/acc_1/contacts': { statusCode: 409, body: { contactId: 'c1' } },
		});
		const response = await deskwootRequestFull(ctxWith(api), 'POST', '/accounts/acc_1/contacts', {
			email: 'a@b.c',
		});
		expect(response).toEqual({ statusCode: 409, body: { contactId: 'c1' } });
	});
});

describe('searchContacts', () => {
	it('searches the workspace and puts exact matches first', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': {
				statusCode: 200,
				body: {
					contacts: [
						{ id: 'c1', email: 'noah.becker@example.com', name: 'Noah Becker Jr' },
						{ id: 'c2', email: 'Noah@Example.com', name: 'Noah Becker' },
					],
				},
			},
		});
		const contacts = await searchContacts(ctxWith(api), ' noah@example.com ');
		expect(contacts.map((c) => c.id)).toEqual(['c2', 'c1']);
		expect(api.calls[0].qs).toEqual({ search: ' noah@example.com ', pageSize: 25 });
	});

	it('copes with an answer without a contact list', async () => {
		const api = fakeApi({ 'GET /accounts/acc_1/contacts': { statusCode: 200, body: {} } });
		expect(await searchContacts(ctxWith(api), 'x')).toEqual([]);
	});
});
