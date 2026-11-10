import { describe, expect, it } from 'vitest';
import {
  assertEngagementTransition, compareCapabilitySnapshots, evaluateCapability,
  logicalOperationKey, validateVerificationEvidence,
  type CapabilityDeclaration, type ExecutionIntent,
} from '../src/engine/capability-contracts.js';

const date = new Date('2026-11-10T18:00:00.000Z');
const grant: CapabilityDeclaration = {
  contractVersion: 1, provider: 'linkedin_official_api', accountId: 'a', actorId: 'm',
  authorization: 'verified', operations: ['create_comment', 'verify_comment'],
  grantId: 'grant-a', authorizationEvidence: 'grant-a:scopes-checked', expiresAt: '2026-11-10T19:00:00.000Z',
};
const intent: ExecutionIntent = { accountId: 'a', actorId: 'm', operation: 'create_comment', environment: 'production' };

describe('capability contracts: falhar fechado', () => {
  it('permite API somente com grant validado, ator correto e prazo vigente', () => {
    expect(evaluateCapability(grant, intent, date)).toEqual({allowed:true,channel:'official_api',requiresManualAction:false});
    expect(evaluateCapability({...grant,authorization:'unknown'}, intent, date)).toMatchObject({allowed:false});
    expect(evaluateCapability({...grant, authorizationEvidence:undefined}, intent, date)).toMatchObject({code:'NO_AUTHORIZATION_EVIDENCE'});
    expect(evaluateCapability({...grant, expiresAt:undefined}, intent, date)).toMatchObject({code:'AUTHORIZATION_EXPIRED'});
  });
  it('impede cross-account, escopo ausente e autorização vencida', () => {
    expect(evaluateCapability(grant,{...intent,accountId:'outro'},date)).toMatchObject({code:'IDENTITY_MISMATCH'});
    expect(evaluateCapability(grant,{...intent,operation:'create_reaction'},date)).toMatchObject({code:'CAPABILITY_MISSING'});
    expect(evaluateCapability(grant,intent,new Date('2026-11-10T19:00:00Z'))).toMatchObject({code:'AUTHORIZATION_EXPIRED'});
  });
  it('nunca utiliza simulador em produção', () => {
    const simulation:CapabilityDeclaration={...grant,provider:'test_simulator',authorization:'unknown'};
    expect(evaluateCapability(simulation,intent,date)).toMatchObject({code:'TEST_ONLY'});
    expect(evaluateCapability(simulation,{...intent,environment:'test'},date)).toMatchObject({channel:'simulation'});
  });
  it('modo assistido só prepara operação manual após aprovação', () => {
    const assisted:CapabilityDeclaration={...grant,provider:'human_assisted',authorization:'unknown'};
    expect(evaluateCapability(assisted,intent,date)).toMatchObject({code:'APPROVAL_REQUIRED'});
    expect(evaluateCapability(assisted,{...intent,humanApprovalId:'approval-1'},date))
      .toMatchObject({channel:'assisted',requiresManualAction:true});
  });
  it('não confunde aceitação com prova de publicação pela API', () => {
    const base={operationKey:'key',receiptRef:'receipt',observedAt:'2026-11-10T18:00:00Z'} as const;
    expect(validateVerificationEvidence({...base,source:'official_api_receipt',status:'ACCEPTED'})).toBe(false);
    expect(validateVerificationEvidence({...base,source:'official_api_receipt',status:'CONFIRMED'})).toBe(true);
    expect(validateVerificationEvidence({...base,source:'human_attestation',status:'CONFIRMED'})).toBe(false);
    expect(validateVerificationEvidence({...base,source:'human_attestation',status:'MANUALLY_CONFIRMED'})).toBe(true);
  });
  it('chave lógica distingue intenção e não aceita URN provisória', () => {
    const a=logicalOperationKey('c','urn:li:activity:123','p','comment','intent-1');
    const b=logicalOperationKey('c','urn:li:activity:123','p','comment','intent-2');
    expect(a).not.toBe(b);
    expect(() => logicalOperationKey('c','ll-idx-0','p','comment','intent')).toThrow();
  });
  it('impede promoção direta de erro, aprovação e aceite a confirmado', () => {
    expect(() => assertEngagementTransition('READY','CONFIRMED')).toThrow();
    expect(() => assertEngagementTransition('APPROVED','CONFIRMED')).toThrow();
    expect(() => assertEngagementTransition('ACCEPTED','CONFIRMED')).toThrow();
    expect(() => assertEngagementTransition('UNKNOWN','EXECUTION_STARTED')).toThrow();
    expect(() => assertEngagementTransition('ACCEPTED','VERIFICATION_PENDING')).not.toThrow();
  });
  it('diferencia operação removida de versão sem mudança de escopo', () => {
    const old={provider:'linkedin',version:'202609',checkedAt:'2026-09-01',operations:['create_comment','read_comment'] as const};
    const changed=compareCapabilitySnapshots(old,{...old,version:'202610',operations:['read_comment']});
    expect(changed.removedOperations).toEqual(['create_comment']);
    expect(changed.requiresReview).toBe(true);
    expect(compareCapabilitySnapshots(old,{...old}).removedOperations).toEqual([]);
  });
});
