export declare function normalizePubkey(input: string | Uint8Array): string;
type Signed<T> = T & {
    author: {
        kind: 'pubkey';
        value: string;
    };
    signature: {
        alg: 'ed25519';
        value: string;
    };
    content_id: string;
};
export declare function signObject<T extends Record<string, any>>(obj: T, privateKey: Uint8Array): Promise<Signed<T>>;
type VerifyOpts = {
    allowUnsigned?: boolean;
};
export declare function verifyObjectSignature(obj: Record<string, any>, opts?: VerifyOpts): Promise<void>;
export declare function generateKeypair(): Promise<{
    publicKey: string;
    privateKey: Uint8Array;
}>;
export {};
