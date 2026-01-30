import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { canonicalize, contentId, toContentObject } from './canonicalization.js';
import { KernelErrorCode, makeKernelError } from './errors.js';
import { validateInvariants } from './invariants.js';
import { validateSchema } from './validator.js';
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
function toBase64Url(bytes) {
    const b64 = Buffer.from(bytes).toString('base64');
    return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function fromBase64Url(str) {
    if (!BASE64URL_RE.test(str)) {
        throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Invalid base64url characters');
    }
    const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
    const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return new Uint8Array(Buffer.from(b64, 'base64'));
}
function fromHex(str) {
    if (str.length % 2 !== 0 || /[^a-fA-F0-9]/.test(str)) {
        throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Invalid hex public key');
    }
    return new Uint8Array(str.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
}
export function normalizePubkey(input) {
    let bytes;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        // Detect hex (even length, hex chars) vs base64/base64url
        const looksHex = trimmed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(trimmed);
        if (looksHex) {
            bytes = fromHex(trimmed);
        }
        else {
            try {
                bytes = fromBase64Url(trimmed);
            }
            catch {
                // fallback: regular base64
                try {
                    bytes = new Uint8Array(Buffer.from(trimmed, 'base64'));
                }
                catch (err) {
                    throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Invalid public key encoding');
                }
            }
        }
    }
    else {
        bytes = input;
    }
    if (bytes.length !== 32) {
        throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Public key must be 32 bytes');
    }
    return toBase64Url(bytes);
}
export async function signObject(obj, privateKey) {
    validateSchema(obj);
    validateInvariants(obj);
    if (!obj.created_at) {
        throw makeKernelError(KernelErrorCode.SCHEMA_INVALID, 'created_at is required before signing');
    }
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
        throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Private key must be 32 bytes');
    }
    const ed = await import('@noble/ed25519');
    if (!ed.etc.sha512Sync) {
        ed.etc.sha512Sync = (msg) => createHash('sha512').update(msg).digest();
    }
    const pubkey = await ed.getPublicKey(privateKey);
    const authorValue = normalizePubkey(pubkey);
    const contentObject = toContentObject({ ...obj, author: undefined, signature: undefined });
    const canonicalBytes = canonicalize(contentObject);
    const sig = await ed.sign(canonicalBytes, privateKey);
    return {
        ...obj,
        author: { kind: 'pubkey', value: authorValue },
        signature: { alg: 'ed25519', value: toBase64Url(sig) },
        content_id: obj.content_id ?? contentId(obj)
    };
}
export async function verifyObjectSignature(obj, opts) {
    const allowUnsigned = opts?.allowUnsigned === true;
    const signature = obj.signature;
    const author = obj.author;
    if (!signature || !author) {
        if (allowUnsigned)
            return;
        throw makeKernelError(KernelErrorCode.SIGNATURE_MISSING, 'Signature is required');
    }
    if (author.kind !== 'pubkey') {
        throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Unsupported author kind');
    }
    if (typeof author.value !== 'string' || author.value.length === 0) {
        throw makeKernelError(KernelErrorCode.AUTHOR_INVALID, 'Author value must be a non-empty string');
    }
    if (signature.alg !== 'ed25519') {
        throw makeKernelError(KernelErrorCode.SIGNATURE_INVALID, 'Unsupported signature algorithm');
    }
    const pubkeyB64 = normalizePubkey(author.value);
    const sigBytes = fromBase64Url(signature.value);
    if (sigBytes.length !== 64) {
        throw makeKernelError(KernelErrorCode.SIGNATURE_INVALID, 'Invalid signature length');
    }
    const contentObject = toContentObject(obj);
    const canonicalBytes = canonicalize(contentObject);
    const ed = await import('@noble/ed25519');
    if (!ed.etc.sha512Sync) {
        ed.etc.sha512Sync = (msg) => createHash('sha512').update(msg).digest();
    }
    const ok = await ed.verify(sigBytes, canonicalBytes, fromBase64Url(pubkeyB64));
    if (!ok) {
        throw makeKernelError(KernelErrorCode.SIGNATURE_INVALID, 'Signature does not match content');
    }
}
// Convenience helper for tests/dev to generate a keypair.
export async function generateKeypair() {
    const priv = randomBytes(32);
    const ed = await import('@noble/ed25519');
    if (!ed.etc.sha512Sync) {
        ed.etc.sha512Sync = (msg) => createHash('sha512').update(msg).digest();
    }
    const pub = await ed.getPublicKey(priv);
    return { publicKey: toBase64Url(pub), privateKey: priv };
}
