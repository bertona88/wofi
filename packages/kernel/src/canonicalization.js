import { createHash } from 'node:crypto';
import { KernelErrorCode, makeKernelError } from './errors.js';
function canonicalizeValue(value) {
    if (value === null)
        return 'null';
    const t = typeof value;
    if (t === 'boolean')
        return value ? 'true' : 'false';
    if (t === 'number') {
        if (!Number.isFinite(value)) {
            throw makeKernelError(KernelErrorCode.CANONICALIZATION_ERROR, 'Non-finite numbers are not allowed in canonical JSON');
        }
        // Use ECMAScript number to string representation (matches JSON.stringify)
        return Number(value).toString();
    }
    if (t === 'string')
        return JSON.stringify(value);
    if (t === 'bigint' || t === 'function' || t === 'symbol') {
        throw makeKernelError(KernelErrorCode.CANONICALIZATION_ERROR, `Unsupported value type: ${t}`);
    }
    if (Array.isArray(value)) {
        const parts = value.map((item) => {
            if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
                return 'null';
            }
            return canonicalizeValue(item);
        });
        return `[${parts.join(',')}]`;
    }
    if (t === 'object') {
        const entries = Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const parts = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeValue(v)}`);
        return `{${parts.join(',')}}`;
    }
    throw makeKernelError(KernelErrorCode.CANONICALIZATION_ERROR, `Unsupported value type: ${t}`);
}
export function canonicalize(obj) {
    try {
        const canonical = canonicalizeValue(obj);
        return new TextEncoder().encode(canonical);
    }
    catch (err) {
        if (err.code === KernelErrorCode.CANONICALIZATION_ERROR) {
            throw err;
        }
        throw makeKernelError(KernelErrorCode.CANONICALIZATION_ERROR, err.message);
    }
}
export function toContentObject(obj) {
    if (obj === null || typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj)) {
        return obj.reduce((acc, item) => {
            if (item === null)
                return acc;
            const cleaned = toContentObject(item);
            if (cleaned !== undefined)
                acc.push(cleaned);
            return acc;
        }, []);
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === null)
            continue;
        if (key === 'content_id' || key === 'signature' || key === 'author')
            continue;
        const cleaned = toContentObject(value);
        if (cleaned !== undefined) {
            result[key] = cleaned;
        }
    }
    return result;
}
export function contentId(obj) {
    const contentObject = toContentObject(obj);
    const canonicalBytes = canonicalize(contentObject);
    const hash = createHash('sha256').update(canonicalBytes).digest('hex');
    return `sha256:${hash}`;
}
