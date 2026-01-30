export type KernelValidationError = Error & {
    code: string;
    path?: string;
    details?: unknown;
};
export declare const KernelErrorCode: {
    readonly SCHEMA_INVALID: "SCHEMA_INVALID";
    readonly INVARIANT_VIOLATION: "INVARIANT_VIOLATION";
    readonly CANONICALIZATION_ERROR: "CANONICALIZATION_ERROR";
    readonly UNKNOWN_SCHEMA_VERSION: "UNKNOWN_SCHEMA_VERSION";
    readonly UNKNOWN_OBJECT_TYPE: "UNKNOWN_OBJECT_TYPE";
    readonly SIGNATURE_MISSING: "SIGNATURE_MISSING";
    readonly SIGNATURE_INVALID: "SIGNATURE_INVALID";
    readonly AUTHOR_INVALID: "AUTHOR_INVALID";
};
type KernelErrorCodeKey = typeof KernelErrorCode[keyof typeof KernelErrorCode];
export declare function makeKernelError(code: KernelErrorCodeKey, message: string, path?: string, details?: unknown): KernelValidationError;
export {};
