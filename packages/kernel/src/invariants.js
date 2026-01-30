import { KernelErrorCode, makeKernelError } from './errors.js';
import { getObjectType } from './validator.js';
const RELATION_SET = new Set([
    'INPUT_OF',
    'OUTPUT_OF',
    'IMPLEMENTS',
    'ABOUT',
    'SUPPORTS',
    'REFUTES',
    'ATTESTS'
]);
function invariant(condition, message, path) {
    if (!condition) {
        throw makeKernelError(KernelErrorCode.INVARIANT_VIOLATION, message, path);
    }
}
function validateConstructionLocal(obj) {
    const inputs = obj?.inputs;
    if (!Array.isArray(inputs))
        return;
    inputs.forEach((input, index) => {
        invariant(input && typeof input === 'object', 'Construction input must be an object', `/inputs/${index}`);
        invariant(typeof input.idea_id === 'string' && input.idea_id.length > 0, 'Construction input must include idea_id', `/inputs/${index}/idea_id`);
        const forbiddenKeys = ['claim_id', 'evidence_id', 'implementation_id', 'construction_id'];
        for (const key of forbiddenKeys) {
            invariant(!(key in input), `Construction inputs must not include ${key}`, `/inputs/${index}/${key}`);
        }
    });
}
function validateEdgeLocal(obj) {
    invariant(RELATION_SET.has(obj.rel), `Invalid edge rel: ${obj.rel}`, '/rel');
}
function validateEdgeReferential(obj, ctx) {
    if (!ctx.getObjectTypeById)
        return;
    const fromId = obj?.from?.id;
    const toId = obj?.to?.id;
    if (!fromId || !toId)
        return;
    const fromType = ctx.getObjectTypeById(fromId);
    const toType = ctx.getObjectTypeById(toId);
    const rel = obj.rel;
    if (fromType === undefined || toType === undefined) {
        throw makeKernelError(KernelErrorCode.INVARIANT_VIOLATION, 'Referential types missing for edge endpoints', '/rel', { fromId, toId });
    }
    switch (rel) {
        case 'INPUT_OF':
            invariant(fromType === 'wofi.idea.v1', 'INPUT_OF must originate from Idea', '/from');
            invariant(toType === 'wofi.construction.v1', 'INPUT_OF must target Construction', '/to');
            break;
        case 'OUTPUT_OF':
            invariant(fromType === 'wofi.construction.v1', 'OUTPUT_OF must originate from Construction', '/from');
            invariant(toType === 'wofi.idea.v1', 'OUTPUT_OF must target Idea', '/to');
            break;
        case 'SUPPORTS':
        case 'REFUTES':
            invariant(fromType === 'wofi.evidence.v1', `${rel} must originate from Evidence`, '/from');
            invariant(toType === 'wofi.claim.v1', `${rel} must target Claim`, '/to');
            break;
        case 'ABOUT':
            invariant(fromType === 'wofi.claim.v1', 'ABOUT must originate from Claim', '/from');
            invariant(toType === 'wofi.idea.v1' || toType === 'wofi.implementation.v1', 'ABOUT must target Idea or Implementation', '/to');
            break;
        case 'IMPLEMENTS':
            invariant(fromType === 'wofi.implementation.v1', 'IMPLEMENTS must originate from Implementation', '/from');
            invariant(toType === 'wofi.idea.v1', 'IMPLEMENTS must target Idea', '/to');
            break;
        default:
            break;
    }
}
function validateImplementationEdges(obj, ctx) {
    if (!ctx.getEdgesByFromId || !ctx.getObjectTypeById)
        return;
    const id = obj?.content_id;
    if (!id)
        return;
    const edges = ctx.getEdgesByFromId(id) ?? [];
    const implementsEdges = edges.filter((edge) => edge.rel === 'IMPLEMENTS');
    invariant(implementsEdges.length === 1, 'Implementation must have exactly one IMPLEMENTS edge');
    const edge = implementsEdges[0];
    if (!edge)
        return;
    const targetType = ctx.getObjectTypeById(edge.to_id);
    invariant(targetType === 'wofi.idea.v1', 'IMPLEMENTS edge must target Idea');
}
export function validateInvariants(obj, ctx) {
    const type = getObjectType(obj);
    if (type === 'wofi.construction.v1') {
        validateConstructionLocal(obj);
    }
    if (type === 'wofi.edge.v1') {
        validateEdgeLocal(obj);
        if (ctx) {
            validateEdgeReferential(obj, ctx);
        }
    }
    if (type === 'wofi.implementation.v1' && ctx) {
        validateImplementationEdges(obj, ctx);
    }
}
