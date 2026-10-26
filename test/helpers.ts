import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IWebhookFunctions,
} from 'n8n-workflow';
import { vi } from 'vitest';

/**
 * Fake n8n contexts for the tests. Every HTTP call goes to a fake
 * httpRequestWithAuthentication that answers from a route table, so no test
 * ever reaches the network.
 */

export const BASE_URL = 'https://deskwoot.example';
export const ACCOUNT_ID = 'acc_1';

export const CREDENTIALS: IDataObject = {
	baseUrl: `${BASE_URL}/`,
	apiToken: 'test-token',
	accountId: ACCOUNT_ID,
};

export const NODE: INode = {
	id: 'node-1',
	name: 'Deskwoot',
	type: 'n8n-nodes-deskwoot.deskwoot',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export interface RecordedCall {
	credentialType: string;
	method: string;
	url: string;
	path: string;
	body?: unknown;
	qs?: unknown;
	options: IHttpRequestOptions;
}

/** An answer of the fake API: a status and a body, or an error the request throws. */
export type FakeAnswer = { statusCode: number; body?: unknown } | Error;

/**
 * Routes by "METHOD /path" (the path after /api/v1, without the query). A
 * list answers its entries in turn. An unknown route fails the test.
 */
export function fakeApi(routes: Record<string, FakeAnswer | FakeAnswer[]>) {
	const calls: RecordedCall[] = [];
	const counters: Record<string, number> = {};
	const httpRequestWithAuthentication = vi.fn(async function (
		credentialType: string,
		options: IHttpRequestOptions,
	) {
		const prefix = `${BASE_URL}/api/v1`;
		const path = options.url.startsWith(prefix) ? options.url.slice(prefix.length) : options.url;
		const method = options.method ?? 'GET';
		calls.push({
			credentialType,
			method,
			url: options.url,
			path,
			body: options.body,
			qs: options.qs,
			options,
		});
		const key = `${method} ${path}`;
		const route = routes[key];
		if (route === undefined) throw new Error(`No fake route for ${key}`);
		const index = counters[key] ?? 0;
		counters[key] = index + 1;
		const answer = Array.isArray(route) ? route[Math.min(index, route.length - 1)] : route;
		if (answer instanceof Error) throw answer;
		return { statusCode: answer.statusCode, body: answer.body, headers: {} };
	});
	return { calls, httpRequestWithAuthentication };
}

type Api = ReturnType<typeof fakeApi>;

const credentialsFn = (credentials: IDataObject) => vi.fn(async () => credentials);

export function executeContext(options: {
	api: Api;
	params: IDataObject | IDataObject[];
	continueOnFail?: boolean;
	credentials?: IDataObject;
}): IExecuteFunctions {
	const perItem = Array.isArray(options.params) ? options.params : [options.params];
	return {
		getInputData: () => perItem.map(() => ({ json: {} })),
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const params = perItem[itemIndex] ?? {};
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Missing parameter ${name}`);
		},
		getCredentials: credentialsFn(options.credentials ?? CREDENTIALS),
		getNode: () => NODE,
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: { httpRequestWithAuthentication: options.api.httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
}

export function loadOptionsContext(api: Api): ILoadOptionsFunctions {
	return {
		getCredentials: credentialsFn(CREDENTIALS),
		getNode: () => NODE,
		helpers: { httpRequestWithAuthentication: api.httpRequestWithAuthentication },
	} as unknown as ILoadOptionsFunctions;
}

export function hookContext(options: {
	api: Api;
	staticData: IDataObject;
	webhookUrl: string;
	event?: string;
}) {
	const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
	const ctx = {
		getNodeParameter: (name: string) => {
			if (name === 'event') return options.event ?? 'conversation.created';
			throw new Error(`Missing parameter ${name}`);
		},
		getNodeWebhookUrl: () => options.webhookUrl,
		getWorkflowStaticData: () => options.staticData,
		getCredentials: credentialsFn(CREDENTIALS),
		getNode: () => NODE,
		logger,
		helpers: { httpRequestWithAuthentication: options.api.httpRequestWithAuthentication },
	} as unknown as IHookFunctions;
	return { ctx, logger };
}

export function webhookContext(options: {
	staticData: IDataObject;
	rawBody?: Buffer;
	readRawBody?: Buffer;
	headers?: IDataObject;
	body: IDataObject;
}) {
	const response = { statusCode: 0, sent: undefined as unknown };
	const res = {
		status(code: number) {
			response.statusCode = code;
			return res;
		},
		json(payload: unknown) {
			response.sent = payload;
			return res;
		},
	};
	const req: { rawBody?: Buffer; readRawBody?: () => Promise<void> } = { rawBody: options.rawBody };
	if (options.readRawBody) {
		const later = options.readRawBody;
		req.readRawBody = async () => {
			req.rawBody = later;
		};
	}
	const ctx = {
		getRequestObject: () => req,
		getResponseObject: () => res,
		getHeaderData: () => options.headers ?? {},
		getBodyData: () => options.body,
		getWorkflowStaticData: () => options.staticData,
		getNode: () => NODE,
		helpers: {
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	} as unknown as IWebhookFunctions;
	return { ctx, response };
}
