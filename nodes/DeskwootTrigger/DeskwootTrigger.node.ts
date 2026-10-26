import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { DeskwootResponse } from '../Deskwoot/shared/transport';
import {
	accountPath,
	deskwootRequest,
	deskwootRequestFull,
	isSuccess,
} from '../Deskwoot/shared/transport';

/**
 * The Deskwoot triggers, all REST hooks: publishing the workflow subscribes
 * the node's webhook URL to one Deskwoot trigger (POST
 * /accounts/<id>/rest-hooks), unpublishing removes it (DELETE
 * .../rest-hooks/<hookId>). Deskwoot then posts the trigger's flat object.
 *
 * Deskwoot signs every delivery with a secret of its own for each hook
 * (X-Deskwoot-Signature: sha256=<hex HMAC SHA256 of the raw body>) and
 * returns that secret once, in the answer to the subscription. The node
 * keeps the hook ID and the secret in the node's static data, like n8n's
 * Stripe Trigger, and refuses every request whose signature does not match.
 *
 * A test listen starts from empty static data of its own (n8n's
 * test-webhooks.ts), so its hook never replaces the published one.
 */

const SIGNATURE_HEADER = 'x-deskwoot-signature';

/** The hook of this node: hookId and secret, kept in the node's static data. */
const hookData = (ctx: IHookFunctions | IWebhookFunctions) => ctx.getWorkflowStaticData('node');

/** Whether the signature header matches the HMAC SHA256 of the raw body under the secret. */
export function isValidSignature(rawBody: Buffer, header: unknown, secret: string): boolean {
	if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
	const received = Buffer.from(header.slice('sha256='.length), 'utf8');
	const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
	return received.length === expected.length && timingSafeEqual(received, expected);
}

export class DeskwootTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deskwoot Trigger',
		name: 'deskwootTrigger',
		icon: { light: 'file:../../icons/deskwoot.svg', dark: 'file:../../icons/deskwoot.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when something happens in Deskwoot',
		defaults: {
			name: 'Deskwoot Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'deskwootApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Deskwoot sends events only to an n8n it can reach from the internet over HTTPS. The trigger also needs a workspace on the Enterprise plan and an API token that an administrator created.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'conversation.created',
				options: [
					{
						name: 'Contact Created',
						value: 'contact.created',
						description:
							'A teammate adds a contact in Deskwoot or an app adds one through the API. Contacts created from incoming messages start Conversation Created instead.',
					},
					{
						name: 'Conversation Assigned',
						value: 'conversation.assigned',
						description:
							'A conversation gets a new assignee. Round robin on a new conversation and automation rules do not set it off.',
					},
					{
						name: 'Conversation Created',
						value: 'conversation.created',
						description:
							'A conversation starts, whether a customer wrote in or your team started it',
					},
					{
						name: 'Conversation Rated',
						value: 'csat.submitted',
						description: 'A customer rates a conversation in the satisfaction survey',
					},
					{
						name: 'Conversation Resolved',
						value: 'conversation.resolved',
						description: 'A conversation is marked resolved',
					},
					{
						name: 'Customer Message Received',
						value: 'message.incoming',
						description:
							'A customer writes in a conversation. Replies and notes from your team do not count.',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				// Deskwoot has no call that reads one hook back, so the stored ID is the record.
				const { hookId } = hookData(this);
				return typeof hookId === 'string' && hookId !== '';
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const body = (await deskwootRequest(this, 'POST', await accountPath(this, '/rest-hooks'), {
					url: this.getNodeWebhookUrl('default'),
					trigger: this.getNodeParameter('event') as string,
				})) as IDataObject | null;
				const id = typeof body?.id === 'string' ? body.id : '';
				const secret = typeof body?.secret === 'string' ? body.secret : '';
				if (!id) {
					throw new NodeOperationError(
						this.getNode(),
						'Deskwoot did not return an ID for this trigger, so it was not turned on.',
					);
				}
				if (!secret) {
					// Without the secret no delivery could be checked: remove the hook again.
					await deskwootRequest(
						this,
						'DELETE',
						await accountPath(this, `/rest-hooks/${encodeURIComponent(id)}`),
					);
					throw new NodeOperationError(
						this.getNode(),
						'Deskwoot did not return the signing secret for this trigger, so n8n could not check that events come from Deskwoot. The trigger was not turned on.',
					);
				}
				const data = hookData(this);
				data.hookId = id;
				data.secret = secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = hookData(this);
				const { hookId } = data;
				if (typeof hookId !== 'string' || !hookId) return true;
				let response: DeskwootResponse;
				try {
					response = await deskwootRequestFull(
						this,
						'DELETE',
						await accountPath(this, `/rest-hooks/${encodeURIComponent(hookId)}`),
					);
				} catch (error) {
					// Deskwoot may still have the hook: keep it, so the next publish uses it again.
					this.logger.warn('Could not reach Deskwoot to remove the trigger subscription', {
						message: (error as Error).message,
					});
					return false;
				}
				// A hook that is gone already answers 200 { deleted: false }. A 401 means
				// the token was revoked, and revoking a token removes its hooks.
				if (!isSuccess(response.statusCode) && response.statusCode !== 401) {
					this.logger.warn('Deskwoot did not remove the trigger subscription', {
						statusCode: response.statusCode,
					});
					return false;
				}
				delete data.hookId;
				delete data.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		if (!Buffer.isBuffer(req.rawBody) && typeof req.readRawBody === 'function') {
			await req.readRawBody();
		}
		const rawBody: unknown = req.rawBody;
		const { secret } = hookData(this);

		if (
			typeof secret !== 'string' ||
			!secret ||
			!Buffer.isBuffer(rawBody) ||
			!isValidSignature(rawBody, this.getHeaderData()[SIGNATURE_HEADER], secret)
		) {
			const res = this.getResponseObject();
			res.status(401).json({ error: 'Invalid signature' });
			return { noWebhookResponse: true };
		}

		return {
			workflowData: [this.helpers.returnJsonArray(this.getBodyData())],
		};
	}
}
