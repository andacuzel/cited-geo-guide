"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitehoundApi = void 0;
class CitehoundApi {
    constructor() {
        this.name = 'citehoundApi';
        this.displayName = 'Citehound API';
        this.documentationUrl = 'https://getcitehound.com/api';
        this.properties = [
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
        this.authenticate = {
            type: 'generic',
            properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
        };
        this.test = {
            request: { baseURL: 'https://getcitehound.com', url: '/v1/me' },
        };
    }
}
exports.CitehoundApi = CitehoundApi;
