import AjvModule from 'ajv';
import { KernelErrorCode, makeKernelError } from './errors.js';
import { schemaMap } from './schemas/index.js';
const Ajv = AjvModule.default ?? AjvModule;
const ajv = new Ajv({
    allErrors: true,
    strict: true,
    allowUnionTypes: true
});
const validators = new Map();
for (const [type, versions] of Object.entries(schemaMap)) {
    const versionMap = new Map();
    for (const [version, schema] of Object.entries(versions)) {
        versionMap.set(version, ajv.compile(schema));
    }
    validators.set(type, versionMap);
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function getObjectType(obj) {
    if (!isRecord(obj)) {
        throw makeKernelError(KernelErrorCode.SCHEMA_INVALID, 'Kernel object must be an object');
    }
    const { type } = obj;
    if (typeof type !== 'string' || type.length === 0) {
        throw makeKernelError(KernelErrorCode.SCHEMA_INVALID, 'Kernel object missing type');
    }
    return type;
}
export function validateSchema(obj) {
    const type = getObjectType(obj);
    const version = isRecord(obj) ? obj.schema_version : undefined;
    if (typeof version !== 'string' || version.length === 0) {
        throw makeKernelError(KernelErrorCode.SCHEMA_INVALID, 'Kernel object missing schema_version');
    }
    const validatorsForType = validators.get(type);
    if (!validatorsForType) {
        throw makeKernelError(KernelErrorCode.UNKNOWN_OBJECT_TYPE, `Unknown kernel object type: ${type}`);
    }
    const validator = validatorsForType.get(version);
    if (!validator) {
        throw makeKernelError(KernelErrorCode.UNKNOWN_SCHEMA_VERSION, `Unknown schema_version ${version} for type ${type}`);
    }
    const valid = validator(obj);
    if (!valid) {
        const firstError = validator.errors?.[0];
        const path = firstError?.instancePath || firstError?.schemaPath;
        const message = firstError?.message || 'Schema validation failed';
        throw makeKernelError(KernelErrorCode.SCHEMA_INVALID, message, path, validator.errors);
    }
}
