import type { LeadPayload } from './payload.js';

/**
 * Converte o evento do LinkLeads no objeto "achatado" que o Linked Helper exporta por webhook,
 * para alimentar sem mudanças quem já lê o Linked Helper (ex.: a ponte do IAD CRM e o botão "Importar LH").
 *
 * Autoria das mensagens: no formato do Linked Helper, quem falou é decidido pelo nome do autor
 * (`messageN_from`) comparado com `my_full_name` (nós) e com `full_name` (o prospect). Por isso as
 * mensagens enviadas pela conta levam `operatorName` como autor, e as recebidas, o nome da pessoa.
 */
export function toLinkedHelperFormat(p: LeadPayload, operatorName: string): Record<string, string | number> {
  const person = p.person;
  const fullName = person.fullName || [person.firstName, person.lastName].filter(Boolean).join(' ');
  const out: Record<string, string | number> = {};
  const set = (k: string, v: unknown) => {
    if (v != null && String(v).trim() !== '') out[k] = typeof v === 'number' ? v : String(v);
  };

  set('id', person.id);
  set('public_identifier', person.linkedinUrl?.match(/\/in\/([^/]+)/)?.[1]);
  set('full_name', fullName);
  set('first_name', person.firstName);
  set('last_name', person.lastName);
  set('headline', person.headline);
  set('profile_url', person.linkedinUrl);
  set('email', person.emails[0]);
  set('phone', person.phones[0]);
  set('location_name', person.location);
  set('organization_1', person.company);
  set('company_name', person.company);
  set('organization_title_1', person.position);
  // mesmo formato do Linked Helper ("DISTANCE_1"…), que o IAD CRM usa nas notas
  if (person.connectionDegree) set('member_distance', `DISTANCE_${person.connectionDegree}`);
  set('my_full_name', operatorName);
  set('campaign', p.campaign?.name);

  // conversa em ordem cronológica, no máximo as 10 últimas (como o Linked Helper)
  const conv = (p.conversation ?? []).slice(-10);
  conv.forEach((m, i) => {
    const n = i + 1;
    set(`message${n}_from`, m.direction === 'out' ? operatorName : fullName);
    set(`message${n}_text`, m.body);
    set(`message${n}_send_at_iso`, m.sentAt);
  });
  // sem conversa, mas com resposta: campo solto que o leitor do IAD entende como resposta DELE
  if (!conv.length && p.reply?.text) set('reply', p.reply.text);

  // extras do LinkLeads (ignorados por leitores do Linked Helper, preservados no dado bruto)
  // marca de origem: o IAD CRM separa por ela o botão "LinkLeads" do "Importar LH" no mesmo balde
  set('linkleads_origem', 'linkleads');
  set('linkleads_event', p.event);
  // papel no grupo comprador, já no rótulo do IAD CRM ("Decisor econômico", "Champion / Mobilizer"…)
  const papel = p.committee?.find((c) => c.role && c.roleConfirmed) ?? p.committee?.find((c) => c.role);
  if (papel?.role) {
    set('linkleads_papel', papel.role);
    out.linkleads_papel_confirmado = papel.roleConfirmed ? 1 : 0;
    set('linkleads_empresa_alvo', papel.company);
  }
  set('linkleads_reply_label', p.reply?.label);
  set('linkleads_reply_summary', p.reply?.summary);
  if (p.committee?.length) set('linkleads_committee', p.committee.map((c) => `${c.company}: ${c.role ?? '—'}`).join('; '));
  if (p.signal) set('linkleads_signal', `${p.signal.title}${p.signal.detail ? ` — ${p.signal.detail}` : ''}`);
  return out;
}
