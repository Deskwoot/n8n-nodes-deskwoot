import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CONTACT_FIELDS, contactFields, contactOperations } from './ContactDescription';
import { conversationFields, conversationOperations } from './ConversationDescription';
import {
	accountPath,
	deskwootError,
	deskwootRequest,
	deskwootRequestFull,
	searchContacts,
} from './shared/transport';

/**
 * The Deskwoot actions: the same ones as the Deskwoot app for Zapier, on the
 * same REST endpoints. Programmatic style because Create or Update Contact
 * needs dependent calls (search, then update, or create and then update the
 * contact a 409 names), which declarative routing cannot express.
 */

const isObject = (value: unknown): value is IDataObject =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const asObject = (value: unknown): IDataObject => (isObject(value) ? value : {});

const asList = (value: unknown): IDataObject[] =>
	Array.isArray(value) ? value.filter(isObject) : [];

const text = (ctx: IExecuteFunctions, name: string, i: number): string => {
	const value = ctx.getNodeParameter(name, i, '');
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
};

const conversationPath = (id: string, suffix = '') =>
	`/conversations/${encodeURIComponent(id)}${suffix}`;

async function startConversation(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const contactEmail = text(this, 'contactEmail', i);
	const contactPhone = text(this, 'contactPhone', i);
	const contactId = text(this, 'contactId', i);
	if (!contactEmail && !contactPhone && !contactId) {
		throw new NodeOperationError(
			this.getNode(),
			'Fill in the contact email, the contact phone or the contact ID.',
			{ itemIndex: i },
		);
	}
	const subject = text(this, 'subject', i);
	const body: IDataObject = {
		inboxId: text(this, 'inboxId', i),
		content: this.getNodeParameter('content', i) as string,
		contentType: 'TEXT',
	};
	if (subject) body.subject = subject;
	if (contactId) body.contactId = contactId;
	if (contactEmail) body.contactEmail = contactEmail;
	if (contactPhone) body.contactPhone = contactPhone;
	return asObject(
		await deskwootRequest(
			this,
			'POST',
			await accountPath(this, '/conversations'),
			body,
			undefined,
			i,
		),
	);
}

async function addMessage(
	this: IExecuteFunctions,
	i: number,
	isPrivate: boolean,
): Promise<IDataObject> {
	const id = text(this, 'conversationId', i);
	return asObject(
		await deskwootRequest(
			this,
			'POST',
			conversationPath(id, '/messages'),
			{
				content: this.getNodeParameter('content', i) as string,
				private: isPrivate,
				contentType: 'TEXT',
			},
			undefined,
			i,
		),
	);
}

async function assignConversation(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const assigneeId = text(this, 'assigneeId', i);
	const teamId = text(this, 'teamId', i);
	if (!assigneeId && !teamId) {
		throw new NodeOperationError(this.getNode(), 'Pick a teammate, a team, or both.', {
			itemIndex: i,
		});
	}
	const body: IDataObject = {};
	if (assigneeId) body.assigneeId = assigneeId;
	if (teamId) body.teamId = teamId;
	return asObject(
		await deskwootRequest(
			this,
			'PATCH',
			conversationPath(text(this, 'conversationId', i)),
			body,
			undefined,
			i,
		),
	);
}

async function addLabel(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const conversationId = text(this, 'conversationId', i);
	const labelId = text(this, 'labelId', i);
	const response = await deskwootRequest(
		this,
		'POST',
		conversationPath(conversationId, '/labels'),
		{ labelId },
		undefined,
		i,
	);
	return { conversationId, labelId, ...asObject(response) };
}

async function createOrUpdateContact(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const email = text(this, 'email', i);
	if (!email) {
		throw new NodeOperationError(this.getNode(), 'Fill in the email address of the contact.', {
			itemIndex: i,
		});
	}
	const additional = asObject(this.getNodeParameter('additionalFields', i, {}));
	const fields: IDataObject = {};
	for (const key of CONTACT_FIELDS) {
		const value = additional[key];
		if (typeof value === 'string' && value.trim()) fields[key] = value.trim();
	}
	const hasFields = Object.keys(fields).length > 0;
	const update = async (contactId: string) =>
		asObject(
			await deskwootRequest(
				this,
				'PATCH',
				await accountPath(this, `/contacts/${encodeURIComponent(contactId)}`),
				fields,
				undefined,
				i,
			),
		);

	const match = (await searchContacts(this, email, i)).find(
		(contact) =>
			typeof contact.email === 'string' && contact.email.toLowerCase() === email.toLowerCase(),
	);
	if (match) return hasFields ? update(String(match.id)) : match;

	const created = await deskwootRequestFull(this, 'POST', await accountPath(this, '/contacts'), {
		email,
		...fields,
	});
	// Created by someone else in the meantime: Deskwoot names it. Only a 409
	// without a code is about this email. One with a code, such as
	// identifier_taken, names a different contact, which must stay untouched.
	if (created.statusCode === 409) {
		const conflict = asObject(created.body);
		const existingId = conflict.contactId;
		if (conflict.code === undefined && typeof existingId === 'string' && existingId) {
			return hasFields ? update(existingId) : { id: existingId, email };
		}
	}
	if (created.statusCode < 200 || created.statusCode >= 300) throw deskwootError(this, created, i);
	return asObject(created.body);
}

async function findContact(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const query = text(this, 'query', i);
	if (!query) {
		throw new NodeOperationError(
			this.getNode(),
			'Fill in an email address, a phone number or a name.',
			{
				itemIndex: i,
			},
		);
	}
	return (await searchContacts(this, query, i)).slice(0, 1);
}

export class Deskwoot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deskwoot',
		name: 'deskwoot',
		icon: { light: 'file:../../icons/deskwoot.svg', dark: 'file:../../icons/deskwoot.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Reply, assign, label and update contacts in Deskwoot',
		defaults: {
			name: 'Deskwoot',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'deskwootApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Contact', value: 'contact' },
					{ name: 'Conversation', value: 'conversation' },
				],
				default: 'conversation',
			},
			...conversationOperations,
			...conversationFields,
			...contactOperations,
			...contactFields,
		],
	};

	methods = {
		loadOptions: {
			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxes = asList(
					await deskwootRequest(this, 'GET', await accountPath(this, '/inboxes')),
				);
				return inboxes.map((inbox) => ({
					name: inbox.channelType ? `${inbox.name} (${inbox.channelType})` : String(inbox.name),
					value: String(inbox.id),
				}));
			},

			async getTeammates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const body = asObject(
					await deskwootRequest(this, 'GET', await accountPath(this, '/agents')),
				);
				return asList(body.agents)
					.filter(
						(agent) =>
							isObject(agent.user) && !agent.suspended && agent.invitationAccepted !== false,
					)
					.map((agent) => {
						const user = asObject(agent.user);
						return {
							name: user.name ? `${user.name} (${user.email})` : String(user.email),
							value: String(user.id),
						};
					});
			},

			async getTeams(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const teams = asList(await deskwootRequest(this, 'GET', await accountPath(this, '/teams')));
				return teams.map((team) => ({ name: String(team.name), value: String(team.id) }));
			},

			async getLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const labels = asList(
					await deskwootRequest(this, 'GET', await accountPath(this, '/labels')),
				);
				return labels.map((label) => ({ name: String(label.title), value: String(label.id) }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let results: IDataObject[];

				if (resource === 'conversation' && operation === 'start') {
					results = [await startConversation.call(this, i)];
				} else if (resource === 'conversation' && operation === 'reply') {
					results = [await addMessage.call(this, i, false)];
				} else if (resource === 'conversation' && operation === 'addNote') {
					results = [await addMessage.call(this, i, true)];
				} else if (resource === 'conversation' && operation === 'assign') {
					results = [await assignConversation.call(this, i)];
				} else if (resource === 'conversation' && operation === 'addLabel') {
					results = [await addLabel.call(this, i)];
				} else if (resource === 'contact' && operation === 'createOrUpdate') {
					results = [await createOrUpdateContact.call(this, i)];
				} else if (resource === 'contact' && operation === 'find') {
					results = await findContact.call(this, i);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not known for "${resource}".`,
						{ itemIndex: i },
					);
				}

				for (const json of results) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					// Wrapping an n8n error again hands back the same error, so name the item here.
					error.context.itemIndex = i;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
