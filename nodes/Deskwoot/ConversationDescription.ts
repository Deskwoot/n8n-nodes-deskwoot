import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['conversation'], operation } });

export const conversationOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversation'] } },
		options: [
			{
				name: 'Add Label',
				value: 'addLabel',
				description: 'Add one of your labels to a conversation',
				action: 'Add a label to a conversation',
			},
			{
				name: 'Add Private Note',
				value: 'addNote',
				description: 'Add a note to a conversation that only your team sees',
				action: 'Add a private note to a conversation',
			},
			{
				name: 'Assign',
				value: 'assign',
				description: 'Assign a conversation to a teammate, a team, or both',
				action: 'Assign a conversation',
			},
			{
				name: 'Reply',
				value: 'reply',
				description: "Send a reply to the customer on the conversation's channel",
				action: 'Reply in a conversation',
			},
			{
				name: 'Start',
				value: 'start',
				description: 'Send a first message to a contact from one of your inboxes',
				action: 'Start a conversation',
			},
		],
		default: 'reply',
	},
];

const conversationIdField = (operation: string[]): INodeProperties => ({
	displayName: 'Conversation ID',
	name: 'conversationId',
	type: 'string',
	required: true,
	default: '',
	displayOptions: show(operation),
	description:
		'The ID of the Deskwoot conversation, for example the conversation ID from the Deskwoot Trigger',
});

export const conversationFields: INodeProperties[] = [
	// Start
	{
		displayName: 'Inbox Name or ID',
		name: 'inboxId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getInboxes' },
		required: true,
		default: '',
		displayOptions: show(['start']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Contact Email',
		name: 'contactEmail',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: show(['start']),
		description:
			'For an email inbox. Deskwoot finds the contact or creates it. Fill in the contact email, the contact phone or the contact ID.',
	},
	{
		displayName: 'Contact Phone',
		name: 'contactPhone',
		type: 'string',
		placeholder: '+4915112345678',
		default: '',
		displayOptions: show(['start']),
		description: 'For an SMS or WhatsApp inbox, in international format such as +4915112345678',
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		default: '',
		displayOptions: show(['start']),
		description:
			'Instead of an email address or phone number, the ID of a contact that already exists in Deskwoot',
	},
	{
		displayName: 'Subject',
		name: 'subject',
		type: 'string',
		default: '',
		displayOptions: show(['start']),
		description: 'The subject line, for email',
	},
	{
		displayName: 'Message',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show(['start']),
		description:
			'The first message the contact gets. Deskwoot sends it only where a business may write first, such as email or SMS, and says why when the channel cannot deliver it.',
	},

	// Reply and Add Private Note
	conversationIdField(['reply', 'addNote', 'assign', 'addLabel']),
	{
		displayName: 'Reply',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show(['reply']),
		description: 'The customer gets this message',
	},
	{
		displayName: 'Note',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show(['addNote']),
		description: 'Only your team sees this note',
	},

	// Assign
	{
		displayName: 'Teammate Name or ID',
		name: 'assigneeId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTeammates' },
		default: '',
		displayOptions: show(['assign']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Team Name or ID',
		name: 'teamId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTeams' },
		default: '',
		displayOptions: show(['assign']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},

	// Add Label
	{
		displayName: 'Label Name or ID',
		name: 'labelId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLabels' },
		required: true,
		default: '',
		displayOptions: show(['addLabel']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
];
