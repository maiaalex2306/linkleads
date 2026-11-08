import { EVENT_LABELS, type LeadPayload } from './payload.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nota legível (HTML simples) que acompanha o contato no CRM. */
export function noteFor(p: LeadPayload): string {
  const parts = [`<p><b>LinkLeads — ${esc(EVENT_LABELS[p.event])}</b></p>`];
  if (p.person.linkedinUrl) parts.push(`<p>LinkedIn: ${esc(p.person.linkedinUrl)}</p>`);
  if (p.committee?.length) parts.push(`<p>Comitê: ${p.committee.map((c) => `${esc(c.company)} — ${esc(c.role ?? 'papel não definido')}`).join('; ')}</p>`);
  if (p.reply) parts.push(`<p>Resposta${p.reply.label ? ` (${esc(p.reply.label)})` : ''}: “${esc(p.reply.text)}”</p>${p.reply.summary ? `<p>${esc(p.reply.summary)}</p>` : ''}`);
  if (p.signal) parts.push(`<p>Sinal: ${esc(p.signal.title)}${p.signal.detail ? ` — ${esc(p.signal.detail)}` : ''}</p>`);
  if (p.campaign) parts.push(`<p>Campanha: ${esc(p.campaign.name)}${p.campaign.step ? ` — ${esc(p.campaign.step)}` : ''}</p>`);
  if (p.conversation?.length)
    parts.push('<p>Conversa:</p><ul>' + p.conversation.slice(-6).map((m) => `<li>${m.direction === 'out' ? 'Eu' : 'Contato'}: ${esc(m.body)}</li>`).join('') + '</ul>');
  return parts.join('');
}
