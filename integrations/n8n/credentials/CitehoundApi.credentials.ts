import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class CitehoundApi implements ICredentialType {
	name = 'citehoundApi';
	displayName = 'Citehound API';
	documentationUrl = 'https://getcitehound.com/api';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'A key that starts with chk_. A free key is sent by email at https://getcitehound.com/api. Pro, Fix and Beyond keys have more features.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
	};

	test: ICredentialTestRequest = {
		request: { baseURL: 'https://getcitehound.com', url: '/v1/me' },
	};
}
