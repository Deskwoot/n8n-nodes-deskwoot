import type { IDataObject, INode, INodeTypes } from 'n8n-workflow';
import { Workflow } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { DeskwootApi } from '../credentials/DeskwootApi.credentials';

const credential = new DeskwootApi();

/** Resolves an expression of the credential the way n8n does, with $credentials set. */
function resolve(expression: unknown, credentials: IDataObject): unknown {
	const node: INode = {
		id: '1',
		name: 'Test',
		type: 'n8n-nodes-base.noOp',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
	const nodeTypes = {
		getByName: () => ({ description: { properties: [] } }),
		getByNameAndVersion: () => ({ description: { properties: [], inputs: [], outputs: [] } }),
		getKnownTypes: () => ({}),
	} as unknown as INodeTypes;
	const workflow = new Workflow({
		id: 'w',
		nodes: [node],
		connections: {},
		active: false,
		nodeTypes,
	});
	return workflow.expression.getParameterValue(
		expression as string,
		null,
		0,
		0,
		'Test',
		[],
		'manual',
		{ $credentials: credentials } as IDataObject,
		undefined,
		false,
	);
}

const testUrl = (credentials: IDataObject) =>
	`${resolve(credential.test.request.baseURL, credentials)}${resolve(credential.test.request.url, credentials)}`;

describe('Deskwoot API credential', () => {
	it('tests with the inbox list of the account, without trailing slashes', () => {
		expect(testUrl({ baseUrl: 'https://deskwoot.com/', accountId: ' cm123 ', apiToken: 't' })).toBe(
			'https://deskwoot.com/api/v1/accounts/cm123/inboxes',
		);
		expect(
			testUrl({ baseUrl: 'https://desk.example.com//', accountId: 'a/b', apiToken: 't' }),
		).toBe('https://desk.example.com/api/v1/accounts/a%2Fb/inboxes');
		expect(testUrl({ baseUrl: '', accountId: 'cm123', apiToken: 't' })).toBe(
			'https://deskwoot.com/api/v1/accounts/cm123/inboxes',
		);
	});

	it('sends the token as a bearer token', () => {
		expect(
			resolve(credential.authenticate.properties.headers?.Authorization, { apiToken: 'abc' }),
		).toBe('Bearer abc');
	});

	it('marks the token as a password and explains 401 and 403', () => {
		const token = credential.properties.find((p) => p.name === 'apiToken');
		expect(token?.typeOptions?.password).toBe(true);
		const codes = (credential.test.rules ?? []).map((rule) =>
			'value' in rule.properties ? rule.properties.value : undefined,
		);
		expect(codes).toEqual([401, 403]);
	});
});
