import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Where the nodes talk to Deskwoot, and the errors they explain.
 *
 * Every call goes to the Deskwoot REST API at the credential's base URL, and
 * n8n adds the API token as a bearer token (credentials/DeskwootApi). The
 * REST API is part of the Enterprise plan, so the answers that matter most
 * get words a person can act on: a workspace on another plan, or a token
 * Deskwoot does not accept. Nothing here logs the token, the trigger's
 * secret or request headers.
 */

export type DeskwootContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export const CREDENTIAL_NAME = 'deskwootApi';

export const DEFAULT_BASE_URL = 'https://deskwoot.com';

export const HELP_URL = 'https://help.deskwoot.com/n8n-integration';

export const ENTERPRISE_MESSAGE =
	'The Deskwoot REST API, which this node signs in with, is part of the Enterprise plan. ' +
	'Upgrade under Settings > Billing in Deskwoot. ' +
	`On other plans, send Deskwoot events to n8n with a Webhook node: ${HELP_URL}`;

export const UNAUTHORIZED_MESSAGE =
	'Deskwoot did not accept this API token. ' +
	'It may have been revoked or expired, or it is an MCP token for AI agents, which does not work here. ' +
	'Also check that the account ID belongs to the same workspace as the token. ' +
	'Create a REST API token in Deskwoot under Settings > API Tokens.';

export interface DeskwootResponse {
	statusCode: number;
	body: unknown;
}

const isObject = (value: unknown): value is IDataObject =>
	!!value && typeof value === 'object' && !Array.isArray(value);

/** The base URL and the account ID of the credential, without trailing slashes or spaces. */
async function connection(ctx: DeskwootContext): Promise<{ base: string; accountId: string }> {
	const credentials = await ctx.getCredentials(CREDENTIAL_NAME);
	const rawBase =
		typeof credentials.baseUrl === 'string' && credentials.baseUrl.trim()
			? credentials.baseUrl
			: DEFAULT_BASE_URL;
	const base = rawBase.trim().replace(/\/+$/, '');
	const accountId = typeof credentials.accountId === 'string' ? credentials.accountId.trim() : '';
	return { base, accountId };
}

/** A path inside the credential's workspace: /accounts/<accountId><path>. */
export async function accountPath(ctx: DeskwootContext, path: string): Promise<string> {
	const { accountId } = await connection(ctx);
	return `/accounts/${encodeURIComponent(accountId)}${path}`;
}

/**
 * One call to the REST API that answers with the status code and the body,
 * whatever the status. Only a request that gets no answer at all throws.
 */
export async function deskwootRequestFull(
	ctx: DeskwootContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<DeskwootResponse> {
	const { base } = await connection(ctx);
	// The token only ever goes to the Deskwoot base URL of the credential.
	const options: IHttpRequestOptions = {
		method,
		url: `${base}/api/v1${path}`,
		headers: { Accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;
	// A request without any answer (no network, a wrong base URL) throws n8n's own NodeApiError.
	const response = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		CREDENTIAL_NAME,
		options,
	)) as { statusCode?: number; body?: unknown };
	return { statusCode: Number(response.statusCode ?? 0), body: response.body };
}

/** The error n8n shows for a Deskwoot answer outside 2xx. */
export function deskwootError(
	ctx: DeskwootContext,
	response: DeskwootResponse,
	itemIndex?: number,
): NodeApiError {
	const { statusCode } = response;
	const body = isObject(response.body) ? response.body : {};
	const error =
		typeof body.error === 'string'
			? body.error
			: typeof body.message === 'string'
				? body.message
				: `Deskwoot answered with status ${statusCode}`;
	const code = typeof body.code === 'string' ? body.code : undefined;

	let message = error;
	if (statusCode === 403 && /enterprise/i.test(error)) message = ENTERPRISE_MESSAGE;
	else if (statusCode === 401) message = UNAUTHORIZED_MESSAGE;

	return new NodeApiError(ctx.getNode(), { ...body } as JsonObject, {
		message,
		description: code ? `Deskwoot error code: ${code}` : undefined,
		httpCode: String(statusCode),
		itemIndex,
	});
}

const isSuccess = (statusCode: number) => statusCode >= 200 && statusCode < 300;

/** One call to the REST API: the body of a 2xx answer, or an error n8n shows. */
export async function deskwootRequest(
	ctx: DeskwootContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	itemIndex?: number,
): Promise<unknown> {
	const response = await deskwootRequestFull(ctx, method, path, body, qs);
	if (!isSuccess(response.statusCode)) throw deskwootError(ctx, response, itemIndex);
	return response.body;
}

/** Contacts whose name, email address or phone number contains the query, exact matches first. */
export async function searchContacts(
	ctx: DeskwootContext,
	query: string,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const body = await deskwootRequest(
		ctx,
		'GET',
		await accountPath(ctx, '/contacts'),
		undefined,
		{ search: query, pageSize: 25 },
		itemIndex,
	);
	const contacts =
		isObject(body) && Array.isArray(body.contacts) ? (body.contacts as IDataObject[]) : [];
	const q = query.trim().toLowerCase();
	const exact = (contact: IDataObject) =>
		[contact.email, contact.phone, contact.name].some(
			(value) => typeof value === 'string' && value.trim().toLowerCase() === q,
		);
	return [...contacts.filter(exact), ...contacts.filter((contact) => !exact(contact))];
}
