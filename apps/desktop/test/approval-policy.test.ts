import { describe, expect, it } from 'vitest';
import { assertApprovalSafe, type ApprovalSafetyState } from '../src/main/approval-policy.js';

const state = (): ApprovalSafetyState => ({
  kind: 'invite_note', actionType: 'SendInvite',
  accountPaused: false, campaignActive: true, campaignArchived: false,
  excluded: false, withinHours: true, remaining: 1, text: 'Olá',
});
describe('aprovação manual não contorna regras do executor', () => {
  it('permite rascunho elegível no horário e orçamento', () => {
    expect(() => assertApprovalSafe(state())).not.toThrow();
  });
  it.each([
    [{ accountPaused: true }, /pausada/],
    [{ campaignActive: false }, /Campanha parada/],
    [{ campaignArchived: true }, /arquivada/],
    [{ actionType: 'MessageToPerson' }, /Rascunho sem ação/],
    [{ blockedReason: 'REPLIED' }, /Contato excluído/],
    [{ excluded: true }, /Contato excluído/],
    [{ withinHours: false }, /Fora do horário/],
    [{ remaining: 0 }, /Limite de ações/],
    [{ remaining: -1 }, /Limite de ações/],
    [{ text: ' ' }, /sem conteúdo/],
  ] as const)('bloqueia envio sem pré-condição %j', (changes, error) => {
    expect(() => assertApprovalSafe({ ...state(), ...changes })).toThrow(error);
  });
  it('comentário exige post canônico em vez de ll-idx-0', () => {
    expect(() => assertApprovalSafe({ ...state(), kind: 'comment', actionType: 'CommentPost', postId: 'll-idx-0' }))
      .toThrow(/canônico/);
    expect(() => assertApprovalSafe({ ...state(), kind: 'comment', actionType: 'CommentPost',
      postId: 'urn:li:activity:7001' })).not.toThrow();
  });
});
