import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Deskwoot } from '../nodes/Deskwoot/Deskwoot.node';
import { executeContext, fakeApi, loadOptionsContext } from './helpers';

const node = new Deskwoot();

const run = async (
	api: ReturnType<typeof fakeApi>,
	params: IDataObject | IDataObject[],
	continueOnFail = false,
) => (await node.execute.call(executeContext({ api, params, continueOnFail })))[0];

const conversation = (operation: string, params: IDataObject = {}) => ({
	resource: 'conversation',
	operation,
	...params,
});

const contact = (operation: string, params: IDataObject = {}) => ({
	resource: 'contact',
	operation,
	...params,
});

describe('Deskwoot node description', () => {
	it('is usable by AI agents and needs the Deskwoot credential', () => {
		expect(node.description.usableAsTool).toBe(true);
		expect(node.description.credentials).toEqual([{ name: 'deskwootApi', required: true }]);
	});

	it('offers the actions of the Zapier app and Find contact', () => {
		const operations = (resource: string) =>
			(
				node.description.properties.find(
					(p: INodeProperties) =>
						p.name === 'operation' && p.displayOptions?.show?.resource?.[0] === resource,
				)?.options as Array<{ value: string }>
			).map((o) => o.value);
		expect(operations('conversation').sort()).toEqual([
			'addLabel',
			'addNote',
			'assign',
			'reply',
			'start',
		]);
		expect(operations('contact').sort()).toEqual(['createOrUpdate', 'find']);
	});
});

describe('Conversation: Start', () => {
	it('posts the first message to the workspace with only the fields that are filled in', async () => {
		const api = fakeApi({
			'POST /accounts/acc_1/conversations': {
				statusCode: 201,
				body: { conversationId: 'cv1', messageId: 'm1', deliveryStatus: 'pending' },
			},
		});
		const out = await run(
			api,
			conversation('start', {
				inboxId: 'in1',
				contactEmail: ' olivia@example.com ',
				contactPhone: '',
				contactId: '',
				subject: 'Your order',
				content: 'Hello Olivia',
			}),
		);
		expect(api.calls[0].body).toEqual({
			inboxId: 'in1',
			content: 'Hello Olivia',
			contentType: 'TEXT',
			subject: 'Your order',
			contactEmail: 'olivia@example.com',
		});
		expect(out).toEqual([
			{
				json: { conversationId: 'cv1', messageId: 'm1', deliveryStatus: 'pending' },
				pairedItem: { item: 0 },
			},
		]);
	});

	it('asks for a contact before it calls Deskwoot', async () => {
		const api = fakeApi({});
		const error = await run(
			api,
			conversation('start', {
				inboxId: 'in1',
				contactEmail: '',
				contactPhone: ' ',
				contactId: '',
				subject: '',
				content: 'Hi',
			}),
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toBe(
			'Fill in the contact email, the contact phone or the contact ID.',
		);
		expect(api.calls).toHaveLength(0);
	});
});

describe('Conversation: Reply and Add Private Note', () => {
	it('sends a reply the customer gets', async () => {
		const api = fakeApi({
			'POST /conversations/cv%201/messages': {
				statusCode: 201,
				body: { id: 'm2', private: false },
			},
		});
		const out = await run(
			api,
			conversation('reply', { conversationId: 'cv 1', content: 'On its way' }),
		);
		expect(api.calls[0].body).toEqual({
			content: 'On its way',
			private: false,
			contentType: 'TEXT',
		});
		expect(out[0].json).toEqual({ id: 'm2', private: false });
	});

	it('adds a note only the team sees', async () => {
		const api = fakeApi({
			'POST /conversations/cv1/messages': { statusCode: 201, body: { id: 'm3' } },
		});
		await run(
			api,
			conversation('addNote', { conversationId: 'cv1', content: 'Called the courier' }),
		);
		expect(api.calls[0].body).toEqual({
			content: 'Called the courier',
			private: true,
			contentType: 'TEXT',
		});
	});
});

describe('Conversation: Assign', () => {
	it('sends only the teammate when no team is picked', async () => {
		const api = fakeApi({
			'PATCH /conversations/cv1': { statusCode: 200, body: { id: 'cv1', assigneeId: 'u1' } },
		});
		await run(api, conversation('assign', { conversationId: 'cv1', assigneeId: 'u1', teamId: '' }));
		expect(api.calls[0].body).toEqual({ assigneeId: 'u1' });
	});

	it('sends both when both are picked', async () => {
		const api = fakeApi({ 'PATCH /conversations/cv1': { statusCode: 200, body: { id: 'cv1' } } });
		await run(
			api,
			conversation('assign', { conversationId: 'cv1', assigneeId: 'u1', teamId: 't1' }),
		);
		expect(api.calls[0].body).toEqual({ assigneeId: 'u1', teamId: 't1' });
	});

	it('asks for a teammate or a team', async () => {
		const api = fakeApi({});
		const error = await run(
			api,
			conversation('assign', { conversationId: 'cv1', assigneeId: '', teamId: '' }),
		).catch((e: unknown) => e);
		expect((error as Error).message).toBe('Pick a teammate, a team, or both.');
		expect(api.calls).toHaveLength(0);
	});
});

describe('Conversation: Add Label', () => {
	it('adds the label and names the conversation and the label in the output', async () => {
		const api = fakeApi({
			'POST /conversations/cv1/labels': { statusCode: 200, body: { success: true } },
		});
		const out = await run(api, conversation('addLabel', { conversationId: 'cv1', labelId: 'l1' }));
		expect(api.calls[0].body).toEqual({ labelId: 'l1' });
		expect(out[0].json).toEqual({ conversationId: 'cv1', labelId: 'l1', success: true });
	});
});

describe('Contact: Create or Update', () => {
	const search = (contacts: IDataObject[]) => ({ statusCode: 200, body: { contacts } });

	it('updates the contact with the same email address', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([
				{ id: 'c9', email: 'noah.b@example.com' },
				{ id: 'c3', email: 'NOAH@example.com' },
			]),
			'PATCH /accounts/acc_1/contacts/c3': {
				statusCode: 200,
				body: { id: 'c3', company: 'Becker Roasters' },
			},
		});
		const out = await run(
			api,
			contact('createOrUpdate', {
				email: 'noah@example.com',
				additionalFields: { company: ' Becker Roasters ', city: '', jobTitle: 'Owner' },
			}),
		);
		expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			'GET /accounts/acc_1/contacts',
			'PATCH /accounts/acc_1/contacts/c3',
		]);
		expect(api.calls[1].body).toEqual({ company: 'Becker Roasters', jobTitle: 'Owner' });
		expect(out[0].json).toEqual({ id: 'c3', company: 'Becker Roasters' });
	});

	it('returns the match unchanged when there is nothing to update', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([{ id: 'c3', email: 'noah@example.com' }]),
		});
		const out = await run(
			api,
			contact('createOrUpdate', { email: 'noah@example.com', additionalFields: {} }),
		);
		expect(api.calls).toHaveLength(1);
		expect(out[0].json).toEqual({ id: 'c3', email: 'noah@example.com' });
	});

	it('creates the contact when there is none', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([]),
			'POST /accounts/acc_1/contacts': {
				statusCode: 201,
				body: { id: 'c4', email: 'emily@example.com', name: 'Emily' },
			},
		});
		const out = await run(
			api,
			contact('createOrUpdate', {
				email: 'emily@example.com',
				additionalFields: { name: 'Emily' },
			}),
		);
		expect(api.calls[1].body).toEqual({ email: 'emily@example.com', name: 'Emily' });
		expect(out[0].json).toEqual({ id: 'c4', email: 'emily@example.com', name: 'Emily' });
	});

	it('updates the contact Deskwoot names in a 409', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([]),
			'POST /accounts/acc_1/contacts': {
				statusCode: 409,
				body: { error: 'Contact with this email already exists', contactId: 'c5' },
			},
			'PATCH /accounts/acc_1/contacts/c5': {
				statusCode: 200,
				body: { id: 'c5', phone: '+4915112345678' },
			},
		});
		const out = await run(
			api,
			contact('createOrUpdate', {
				email: 'liam@example.com',
				additionalFields: { phone: '+4915112345678' },
			}),
		);
		expect(out[0].json).toEqual({ id: 'c5', phone: '+4915112345678' });
	});

	it('returns the contact a 409 names when there is nothing to update', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([]),
			'POST /accounts/acc_1/contacts': { statusCode: 409, body: { contactId: 'c5' } },
		});
		const out = await run(
			api,
			contact('createOrUpdate', { email: 'liam@example.com', additionalFields: {} }),
		);
		expect(out[0].json).toEqual({ id: 'c5', email: 'liam@example.com' });
		expect(api.calls).toHaveLength(2);
	});

	it('leaves a different contact alone when its identifier is in the way', async () => {
		// The contact made with this email later got another email, but kept
		// this one as its identifier.
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([]),
			'POST /accounts/acc_1/contacts': {
				statusCode: 409,
				body: {
					error: 'Another contact in this account already has that identifier.',
					code: 'identifier_taken',
					contactId: 'c7',
				},
			},
		});
		const error = await run(
			api,
			contact('createOrUpdate', {
				email: 'a@example.com',
				additionalFields: { name: 'Bob' },
			}),
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toBe(
			'Another contact in this account already has that identifier.',
		);
		expect((error as NodeApiError).description).toBe('Deskwoot error code: identifier_taken');
		expect(api.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});

	it("fails with Deskwoot's text when the contact cannot be created", async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': search([]),
			'POST /accounts/acc_1/contacts': {
				statusCode: 400,
				body: { error: 'Invalid email address' },
			},
		});
		const error = await run(
			api,
			contact('createOrUpdate', { email: 'nope', additionalFields: {} }),
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toBe('Invalid email address');
	});

	it('asks for the email address before it calls Deskwoot', async () => {
		const api = fakeApi({});
		await expect(
			run(api, contact('createOrUpdate', { email: ' ', additionalFields: {} })),
		).rejects.toThrow('Fill in the email address of the contact.');
		expect(api.calls).toHaveLength(0);
	});
});

describe('Contact: Find', () => {
	it('returns the best match only', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': {
				statusCode: 200,
				body: {
					contacts: [
						{ id: 'c1', name: 'Noah Becker Jr' },
						{ id: 'c2', name: 'Noah Becker' },
					],
				},
			},
		});
		const out = await run(api, contact('find', { query: 'Noah Becker' }));
		expect(out).toEqual([{ json: { id: 'c2', name: 'Noah Becker' }, pairedItem: { item: 0 } }]);
	});

	it('returns nothing when no contact matches', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/contacts': { statusCode: 200, body: { contacts: [] } },
		});
		expect(await run(api, contact('find', { query: 'nobody' }))).toEqual([]);
	});
});

describe('errors', () => {
	it('keeps going with an error item when Continue On Fail is on', async () => {
		const api = fakeApi({
			'POST /conversations/bad/messages': {
				statusCode: 404,
				body: { error: 'Conversation not found' },
			},
			'POST /conversations/good/messages': { statusCode: 201, body: { id: 'm1' } },
		});
		const out = await run(
			api,
			[
				conversation('reply', { conversationId: 'bad', content: 'x' }),
				conversation('reply', { conversationId: 'good', content: 'y' }),
			],
			true,
		);
		expect(out).toEqual([
			{ json: { error: 'Conversation not found' }, pairedItem: { item: 0 } },
			{ json: { id: 'm1' }, pairedItem: { item: 1 } },
		]);
	});

	it('fails the item with the API error and its index otherwise', async () => {
		const api = fakeApi({
			'POST /conversations/good/messages': { statusCode: 201, body: { id: 'm1' } },
			'POST /conversations/bad/messages': {
				statusCode: 403,
				body: {
					error: 'API access requires an Enterprise plan. Please upgrade at /settings/billing',
				},
			},
		});
		const error = await run(api, [
			conversation('reply', { conversationId: 'good', content: 'x' }),
			conversation('reply', { conversationId: 'bad', content: 'y' }),
		]).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toContain('part of the Enterprise plan');
		expect((error as NodeApiError).context.itemIndex).toBe(1);
	});

	it('names the item on an error of the request itself', async () => {
		const failure = new NodeApiError(
			{ id: 'n', name: 'Deskwoot', type: 't', typeVersion: 1, position: [0, 0], parameters: {} },
			{ message: 'connect ECONNREFUSED' },
		);
		const api = fakeApi({
			'POST /conversations/a/messages': { statusCode: 201, body: { id: 'm1' } },
			'POST /conversations/b/messages': failure,
		});
		const error = await run(api, [
			conversation('reply', { conversationId: 'a', content: 'x' }),
			conversation('reply', { conversationId: 'b', content: 'y' }),
		]).catch((e: unknown) => e);
		expect(error).toBe(failure);
		expect(failure.context.itemIndex).toBe(1);
	});
});

describe('dropdowns', () => {
	it('lists inboxes with their channel', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/inboxes': {
				statusCode: 200,
				body: [{ id: 'in1', name: 'Support email', channelType: 'EMAIL' }],
			},
		});
		expect(await node.methods.loadOptions.getInboxes.call(loadOptionsContext(api))).toEqual([
			{ name: 'Support email (EMAIL)', value: 'in1' },
		]);
	});

	it('lists active teammates only', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/agents': {
				statusCode: 200,
				body: {
					agents: [
						{
							suspended: false,
							invitationAccepted: true,
							user: { id: 'u1', name: 'Lucas', email: 'lucas@example.com' },
						},
						{
							suspended: true,
							invitationAccepted: true,
							user: { id: 'u2', name: 'Mia', email: 'mia@example.com' },
						},
						{
							suspended: false,
							invitationAccepted: false,
							user: { id: 'u3', name: 'Ben', email: 'ben@example.com' },
						},
						{ suspended: false, user: { id: 'u4', name: '', email: 'ava@example.com' } },
					],
				},
			},
		});
		expect(await node.methods.loadOptions.getTeammates.call(loadOptionsContext(api))).toEqual([
			{ name: 'Lucas (lucas@example.com)', value: 'u1' },
			{ name: 'ava@example.com', value: 'u4' },
		]);
	});

	it('lists teams and labels', async () => {
		const api = fakeApi({
			'GET /accounts/acc_1/teams': { statusCode: 200, body: [{ id: 't1', name: 'Billing' }] },
			'GET /accounts/acc_1/labels': { statusCode: 200, body: [{ id: 'l1', title: 'delivery' }] },
		});
		expect(await node.methods.loadOptions.getTeams.call(loadOptionsContext(api))).toEqual([
			{ name: 'Billing', value: 't1' },
		]);
		expect(await node.methods.loadOptions.getLabels.call(loadOptionsContext(api))).toEqual([
			{ name: 'delivery', value: 'l1' },
		]);
	});
});
