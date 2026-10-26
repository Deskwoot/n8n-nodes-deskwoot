import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DeskwootApi implements ICredentialType {
	name = 'deskwootApi';

	displayName = 'Deskwoot API';

	icon: Icon = { light: 'file:../icons/deskwoot.svg', dark: 'file:../icons/deskwoot.svg' };

	documentationUrl = 'https://help.deskwoot.com/n8n-integration';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://deskwoot.com',
			description: 'Leave as is unless Deskwoot gave you another address.',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create it in Deskwoot under Settings > API Tokens with the scopes Read and Write. The Deskwoot REST API is part of the Enterprise plan. Only a token created by an administrator can turn on Deskwoot triggers.',
		},
		{
			displayName: 'Account ID',
			name: 'accountId',
			type: 'string',
			required: true,
			default: '',
			description: 'Shown on the same page under Your Account ID.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	// Listing the inboxes checks the token, the account ID and the Read scope at once.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{String($credentials.baseUrl || "https://deskwoot.com").trim().replace(/\\/+$/, "")}}/api/v1',
			url: '=/accounts/{{encodeURIComponent(String($credentials.accountId).trim())}}/inboxes',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Deskwoot did not accept this API token and account ID. Check the account ID: Deskwoot shows it under Settings > API Tokens as Your Account ID. The token may have been revoked or expired, or it is an MCP token for AI agents, which does not work here.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						'Deskwoot refused the token. The Deskwoot REST API is part of the Enterprise plan, and the token needs the scope Read. On other plans, send Deskwoot events to n8n with a Webhook node: https://help.deskwoot.com/n8n-integration',
				},
			},
		],
	};
}
