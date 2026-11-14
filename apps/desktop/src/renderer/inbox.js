/* global h, toast, safe, renderView, api */
/* Aprovações (comentário, nota de convite, mensagem) e Inbox de respostas. */

const DRAFT_KIND = { comment: 'Comentário em post', invite_note: 'Nota de convite', message: 'Mensagem' };
const REPLY_LABEL = {
  interessado: 'Interessado', objecao: 'Objeção', agora_nao: 'Agora não', indicou_outro: 'Indicou outra pessoa', opt_out: 'Pediu para parar', neutro: 'Neutro',
};

async function approvalsView(a) {
  const drafts = await api.listDrafts(a.id, 'review');
  if (!drafts.length) return h('p', { class: 'muted' }, 'Nada aguardando aprovação.');
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'A IA escreveu estes textos. Edite se quiser e aprove para executar.' + (a.running ? '' : ' Inicie a conta para executar.')),
    ...drafts.map((d) => {
      const it = d.interpretation || {};
      const text = h('textarea', { value: d.comment });
      const limit = d.kind === 'invite_note' ? 300 : d.kind === 'message' ? 1200 : 400;
      const counter = h('span', { class: 'muted' }, `${d.comment.length}/${limit}`);
      text.addEventListener('input', () => { counter.textContent = `${text.value.length}/${limit}`; });
      return h('div', { class: 'card stack' },
        h('div', { class: 'row' }, h('span', { class: 'kind' }, DRAFT_KIND[d.kind] || d.kind), h('strong', { style: 'flex:1' }, d.personName), h('span', { class: 'muted' }, d.createdAt)),
        d.kind === 'comment' && h('div', { class: 'post' }, d.postText || '(texto do post indisponível)'),
        d.kind === 'comment'
          ? h('div', { class: 'ai' },
              h('div', {}, h('b', {}, 'O que a IA entendeu: '), it.summary || '—'),
              h('div', {}, h('b', {}, 'Ponto central: '), it.mainPoint || '—'),
              h('div', {}, h('b', {}, 'Trabalho do autor: '), it.authorWork || '—'),
              h('div', {}, h('b', {}, 'Tipo/temas: '), [it.postType, ...(it.topics || [])].filter(Boolean).join(', ') || '—'))
          : it.hook && h('div', { class: 'ai' }, h('b', {}, 'Gancho usado pela IA: '), it.hook),
        d.status === 'approved' && h('p', { class: 'muted' }, 'CONCILIACAO OBRIGATORIA: o envio foi iniciado ou interrompido. Verifique a propria publicacao na conta do LinkedIn. Nao reenviar nem descartar ate conciliar.'),
        h('label', {}, 'Texto', text), counter,
        h('div', { class: 'row' },
          d.status === 'approved' && d.kind === 'comment' &&
          h('button', { onclick: async () => {
            if (!window.confirm('Confirma que VIU este comentario publicado pelo perfil ativo no post correto no LinkedIn? Esta operacao NAO envia mensagem; apenas registra sua verificacao manual.')) return;
            await safe(() => api.confirmVisibleComment(a.id, d.id), 'Publicacao conciliada manualmente');
            renderView();
          } }, 'Conferi: comentario esta publicado'),
          h('button', { class: 'primary', disabled: !a.running || d.status !== 'pending', onclick: async (e) => {
            e.target.disabled = true;
            const r = await safe(() => api.approveDraft(a.id, d.id, text.value));
            toast(r && r.ok ? 'Feito' : `Não executado: ${(r && r.message) || 'erro'}`);
            renderView();
          } }, d.kind === 'comment' ? 'Aprovar e publicar' : 'Aprovar e enviar'),
          h('button', { disabled: d.status !== 'pending', onclick: () => safe(() => api.rejectDraft(a.id, d.id), 'Descartado').then(renderView) }, 'Descartar'),
        ),
      );
    }),
  );
}

let inboxOnlyOpen = true;

async function inboxView(a) {
  const items = await api.listInbox(a.id, inboxOnlyOpen);
  const head = h('div', { class: 'row' },
    h('label', { class: 'row', style: 'display:flex;flex:1' },
      h('input', { type: 'checkbox', checked: inboxOnlyOpen, onchange: (e) => { inboxOnlyOpen = e.target.checked; renderView(); } }), 'Só não tratadas'),
    a.running && h('button', { onclick: () => safe(() => api.checkInbox(a.id)).then((r) => { toast(r ? `${r.newReplies.length} resposta(s) nova(s)` : 'Verificado'); renderView(); }) }, 'Verificar inbox agora'),
  );
  if (!items.length) return h('div', { class: 'stack' }, head, h('p', { class: 'muted' }, 'Nenhuma resposta registrada. A caixa de entrada só será consultada quando você clicar em "Verificar inbox agora".'));
  return h('div', { class: 'stack' }, head,
    h('p', { class: 'muted' }, 'As respostas são identificadas pela consulta manual ao Inbox ou pela verificação da conversa antes do envio de uma mensagem. Depois de identificadas, interrompem a sequência desse contato.'),
    ...items.map((it) => {
      const m = it.lastInbound;
      const thread = h('div', { class: 'thread' });
      return h('div', { class: 'card stack' },
        h('div', { class: 'row' },
          h('strong', { style: 'flex:1' }, it.name, it.company ? h('span', { class: 'muted' }, ` · ${it.company}`) : ''),
          m.aiLabel && h('span', { class: 'label ' + m.aiLabel }, REPLY_LABEL[m.aiLabel] || m.aiLabel),
          h('span', { class: 'muted' }, m.sentAt.slice(0, 16).replace('T', ' '))),
        h('div', { class: 'bubble in' }, m.body),
        m.aiSummary && h('div', { class: 'ai' }, m.aiSummary),
        thread,
        h('div', { class: 'row' },
          h('button', { class: 'link', onclick: async () => {
            if (thread.childElementCount) return thread.replaceChildren();
            const msgs = await api.inboxThread(a.id, it.personId);
            thread.replaceChildren(...msgs.map((x) => h('div', { class: 'bubble ' + x.direction }, x.body)));
          } }, 'ver conversa'),
          it.unhandled > 0 && h('button', { onclick: () => safe(() => api.markHandled(a.id, it.personId), 'Marcado como tratado').then(renderView) }, 'Marcar como tratado')),
      );
    }),
  );
}
