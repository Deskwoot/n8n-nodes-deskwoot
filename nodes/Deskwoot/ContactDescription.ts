import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['contact'], operation } });

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{
				name: 'Create or Update',
				value: 'createOrUpdate',
				description: 'Update the contact with this email address, or create it when there is none',
				action: 'Create or update a contact',
			},
			{
				name: 'Find',
				value: 'find',
				description: 'Find a contact by email address, phone number or name',
				action: 'Find a contact',
			},
		],
		default: 'createOrUpdate',
	},
];

/** The optional contact fields, with the name Deskwoot's API gives each. */
export const CONTACT_FIELDS = ['name', 'phone', 'company', 'jobTitle', 'city', 'country'] as const;

export const contactFields: INodeProperties[] = [
	// Create or Update
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		required: true,
		default: '',
		displayOptions: show(['createOrUpdate']),
		description: 'Deskwoot updates the contact with this email address, or creates it',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['createOrUpdate']),
		options: [
			{ displayName: 'City', name: 'city', type: 'string', default: '' },
			{ displayName: 'Company', name: 'company', type: 'string', default: '' },
			{ displayName: 'Country', name: 'country', type: 'string', default: '' },
			{ displayName: 'Job Title', name: 'jobTitle', type: 'string', default: '' },
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				placeholder: '+4915112345678',
				default: '',
				description: 'In international format, such as +4915112345678',
			},
		],
	},

	// Find
	{
		displayName: 'Email, Phone or Name',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(['find']),
		description:
			'The node returns the one contact that matches best, an exact match first. When no contact matches, it returns nothing.',
	},
];
