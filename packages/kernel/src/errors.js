export const KernelErrorCode = {
    SCHEMA_INVALID: 'SCHEMA_INVALID',
    INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
    CANONICALIZATION_ERROR: 'CANONICALIZATION_ERROR',
    UNKNOWN_SCHEMA_VERSION: 'UNKNOWN_SCHEMA_VERSION',
    UNKNOWN_OBJECT_TYPE: 'UNKNOWN_OBJECT_TYPE',
    SIGNATURE_MISSING: 'SIGNATURE_MISSING',
    SIGNATURE_INVALID: 'SIGNATURE_INVALID',
    AUTHOR_INVALID: 'AUTHOR_INVALID'
};
export function makeKernelError(code, message, path, details) {
    const err = new Error(message);
    err.code = code;
    if (path)
        err.path = path;
    if (details !== undefined)
        err.details = details;
    return err;
}
