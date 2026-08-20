import { env, platformEndpoints } from '../src/config/env.js';
import { defaultToolRegistration, platformRegistrationDocument } from '../src/config/registration.js';

console.log('\n=== PLATFORM REGISTRATION (give these to the tool/provider admin) ===\n');
console.log(JSON.stringify(platformRegistrationDocument, null, 2));

console.log('\n=== TOOL REGISTRATION (what this platform will launch) ===\n');
console.log(JSON.stringify(defaultToolRegistration, null, 2));

console.log('\nIssuer     :', env.issuer);
console.log('Key id     :', env.keyId);
console.log('Public JWKS:', platformEndpoints.jwksUrl, '\n');
