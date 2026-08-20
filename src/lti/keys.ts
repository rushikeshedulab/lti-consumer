import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importPKCS8, importSPKI, exportJWK, type JWK, type KeyObject, type CryptoKey } from 'jose';
import { env } from '../config/env.js';

/**
 * The PLATFORM's RSA keypair.
 *
 * This is the key that signs every LTI id_token. It is read from disk by the
 * backend only - never exposed to the React app, never sent over the wire. The
 * tool verifies launches against the PUBLIC half at /.well-known/jwks.json.
 */
const ALG = 'RS256';

let privateKeyPromise: Promise<CryptoKey | KeyObject> | null = null;
let publicJwkPromise: Promise<JWK> | null = null;

function readPem(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    throw new Error(`Could not read key file "${path}". Run \`npm run keys:generate\` in lti-consumer-lms first.`);
  }
}

export function getPrivateKey(): Promise<CryptoKey | KeyObject> {
  privateKeyPromise ??= importPKCS8(readPem(env.privateKeyPath), ALG);
  return privateKeyPromise;
}

let publicKeyPromise: Promise<CryptoKey | KeyObject> | null = null;

/** Used to verify the access tokens this platform issued itself. */
export function getPublicKey(): Promise<CryptoKey | KeyObject> {
  publicKeyPromise ??= importSPKI(readPem(env.publicKeyPath), ALG);
  return publicKeyPromise;
}

export function getPublicJwk(): Promise<JWK> {
  publicJwkPromise ??= (async () => {
    const key = await importSPKI(readPem(env.publicKeyPath), ALG);
    const jwk = await exportJWK(key);
    return { ...jwk, kid: env.keyId, alg: ALG, use: 'sig' };
  })();
  return publicJwkPromise;
}

export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  return { keys: [await getPublicJwk()] };
}

export const SIGNING_ALG = ALG;
