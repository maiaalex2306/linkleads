/* global h, toast, safe, renderView, api */
/* Diagnóstico somente leitura: valida os seletores nas páginas reais, sem nenhuma ação na conta. */

const DIAG_PAGES = [
  ['perfil', 'Perfil de alguém que NÃO é sua conexão (linkedin.com/in/…)', 'nome, título, botão Conectar e menu "Mais"'],
  ['perfil', 'Perfil de uma conexão sua (1º grau)', 'botão Mensagem e grau 1º'],
  ['perfil', 'Perfil com convite pendente', 'botão Pendente'],
  ['perfil', 'Perfil de uma conexão com a janela de mensagem aberta (clique em Mensagem você mesmo)', 'histórico, caixa de texto e botão Enviar'],
  ['perfil', 'Perfil com a janela de convite aberta (clique em Conectar, NÃO envie)', 'Adicionar nota, Enviar sem nota, campo da nota'],
  ['atividade', 'Atividade de alguém: …/recent-activity/all/', 'posts, texto, botão Gostei'],
  ['post', 'Um post aberto: …/feed/update/urn:li:activity:…/ (clique em Comentar, NÃO publique)', 'caixa de comentário e botão Publicar'],
  ['mensagens', 'Mensagens (linkedin.com/messaging/) com uma conversa aberta', 'lista de conversas, não lidas e histórico'],
  ['contato', 'Informações de contato de uma conexão: …/overlay/contact-info/', 'e-mail e telefone'],
  ['empresa_pessoas', 'Página "Pessoas" de uma empresa: linkedin.com/company/…/people/', 'cartões de pessoas'],
  ['empresa_vagas', 'Página "Vagas" de uma empresa: linkedin.com/company/…/jobs/', 'vagas abertas'],
];
const diagReports = [];
const DIAG_CODE_PT = {
  CARD_NOT_FOUND: 'Nenhum cartão reconhecido',
  CARD_ID_CONFLICT: 'Identificadores do cartão incompatíveis',
  CARD_ID_PROVISIONAL: 'URN sem comprovação',
  RESHARE_CLASSIFICATION_ERROR: 'Republicação sem classificação conclusiva',
  RESHARE_EXCLUDED: 'Republicação excluída pela campanha',
  AUTHOR_UNVERIFIED: 'Autoria pendente de comprovação',
  AUTHOR_MISMATCH: 'Publicação de terceiro',
  REACTION_UNKNOWN: 'Estado da curtida desconhecido',
  LIKE_NOT_CONFIRMED: 'Curtida enviada sem confirmação',
  EDITOR_NOT_FOUND: 'Editor ou botão não reconhecido',
  COMMENT_SUBMISSION_UNCERTAIN: 'Comentário sem confirmação',
  AI_NOT_READY: 'IA indisponível ou resultado inválido',
  UI_CHANGED: 'Contrato de interface alterado',
  POST_AGE_UNVERIFIED: 'Data da publicação não confirmada',
  POST_TOO_OLD: 'Publicação fora da janela configurada',
  ALREADY_LIKED: 'Publicação já curtida',
  POST_EMPTY: 'Publicação sem conteúdo utilizável',
  POST_ELIGIBLE: 'Publicação elegível',
};
const DIAG_STATUS_PT = {
  ELIGIBLE: 'Elegível', NOT_ELIGIBLE: 'Excluído',
  REVIEW_REQUIRED: 'Revisão obrigatória',
};
function diagReportCard(r, i) {
  const missing = r.keys.filter((k) => !k.found && !k.conditional);
  const absentCond = r.keys.filter((k) => !k.found && k.conditional);
  const label = (k) => `${k.key}${k.found ? ` (${k.count}${k.candidate > 0 ? `, alternativa ${k.candidate + 1}` : ''})` : ''}`;
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' },
      h('strong', { style: 'flex:1' }, `#${i + 1} · ${r.page} · ${r.path}`),
      h('span', { class: 'muted' }, `idioma ${r.uiLanguage} · seletores ${r.selectorsVersion}`)),
    r.primaryCode && r.primaryCode !== 'OK' && h('div', {
      style: 'color:var(--risk);font-weight:650',
    }, 'Diagnóstico principal: ' + r.primaryCode + ' — ' + (DIAG_CODE_PT[r.primaryCode] || 'Revisão técnica necessária')),
    r.selectorConfiguration && h('section', { class: 'post-diagnosis card stack' },
      h('strong', {}, 'Integridade e procedência dos seletores'),
      h('div', { class: 'muted' },
        'Versão efetiva: ' + r.selectorConfiguration.effectiveVersion +
        ' · SHA-256: ' + r.selectorConfiguration.effectiveSha256),
      ...r.selectorConfiguration.sources.map((source) =>
        h('div', { style: source.status === 'rejected' ? 'color:var(--risk)' : 'color:var(--ok)' },
          source.name + ': ' + (source.status === 'accepted' ? 'aceito' : 'REJEITADO') +
          ' · SHA-256: ' + source.sha256 +
          ' · chaves: ' + (source.changedKeys.join(', ') || 'nenhuma'))),
      ...r.selectorConfiguration.issues.map((issue) =>
        h('div', { style: 'color:var(--risk)' },
          issue.source + ' / ' + (issue.key || 'documento') + ': ' + issue.code)),
      h('details', {},
        h('summary', { class: 'muted' }, 'Ver procedência de cada chave'),
        h('div', { class: 'muted', style: 'overflow-wrap:anywhere' },
          Object.entries(r.selectorConfiguration.origins).map(([key, origin]) =>
            key + ': ' + origin).join(' · '))),
    ),
    r.layout && h('section', { class: 'post-diagnosis card stack' },
      h('strong', {}, 'Comparação estrutural por página e idioma'),
      h('div', {}, 'Baseline: ' + (r.layout.comparison?.status || 'sem leitura') +
        ' · hash atual: ' + r.layout.hash),
      r.layout.comparison?.baselineHash && h('div', { class: 'muted' },
        'SHA-256 anterior: ' + r.layout.comparison.baselineHash),
      r.layout.comparison?.changedKeys?.length > 0 && h('div', { style: 'color:var(--risk)' },
        'Seletores alterados: ' + r.layout.comparison.changedKeys.join(', ')),
      r.layout.comparison?.status === 'UI_CHANGED' &&
        h('p', { style: 'color:var(--bad);font-weight:650' },
          'Ação bloqueada nesta página: controle obrigatório anteriormente reconhecido desapareceu. É necessário revisar o layout antes de interagir.'),
    ),
    (r.blocked.checkpoint || r.blocked.loggedOut) && h('div', { style: 'color:var(--bad)' }, r.blocked.checkpoint ? 'Verificação de segurança na tela: resolva-a manualmente antes de continuar.' : 'Sessão desconectada: faça login na janela da conta.'),
    h('div', {}, h('b', {}, 'Encontrados: '), r.keys.filter((k) => k.found).map(label).join(', ') || '—'),
    h('div', { style: missing.length ? 'color:var(--risk)' : 'color:var(--ok)' }, h('b', {}, 'Obrigatórios não encontrados: '), missing.map((k) => k.key).join(', ') || 'nenhum'),
    absentCond.length > 0 && h('div', { class: 'muted' }, 'Ausentes, mas só aparecem em certas situações (janela aberta, página vazia, dado que a pessoa não tem): ', absentCond.map((k) => k.key).join(', ')),
    r.labels.length > 0 && h('div', {}, h('b', {}, 'Botões por rótulo: '), r.labels.map((l) => `${l.label} ${l.matched ? '✓' : '✗'}`).join(' · ')),
    r.posts && h('section', { class: 'post-diagnosis card stack' },
      h('strong', {}, 'Reconhecimento de publicações — somente leitura'),
      h('div', {}, 'Publicações encontradas: ' + r.posts.recognized
        + ' · URNs verificáveis: ' + r.posts.canonical
        + ' · URNs provisórias: ' + r.posts.provisional),
      h('div', {}, 'Datas verificáveis: ' + r.posts.dated
        + ' · Datas desconhecidas: ' + r.posts.undated
        + ' · Reações sem estado confiável: ' + r.posts.reactionUnknown),
      (r.posts.provisional || r.posts.undated || r.posts.reactionUnknown)
        && h('p', { class: 'muted' },
          'Uma publicação sem identificador, data ou estado verificável não autoriza curtidas ou comentários. Salve o relatório para ajustar o leitor.'),
      r.posts.decisions?.length > 0 &&
        h('details', { open: true },
          h('summary', {}, 'Decisão individual de cada cartão (' + r.posts.decisions.length + ')'),
          h('div', { class: 'muted' },
            'Evidências estruturais e códigos técnicos. Nomes, texto, links e URNs foram excluídos.'),
          h('table', {},
            h('tr', {},
              h('th', {}, 'Cartão'), h('th', {}, 'Classificação'),
              h('th', {}, 'Código'), h('th', {}, 'Evidências')),
            ...r.posts.decisions.slice(0, 60).map((d) => h('tr', {},
              h('td', {}, '#' + d.ordinal),
              h('td', {}, DIAG_STATUS_PT[d.status] || d.status),
              h('td', {}, h('b', {}, d.code),
                h('div', { class: 'muted' }, DIAG_CODE_PT[d.code] || d.stage)),
              h('td', { class: 'muted' },
                d.evidence.kind + ' · URN ' + (d.evidence.canonical ? 'confirmada' : 'provisória') +
                ' · autor ' + (d.evidence.actorLinkPresent ? 'com link' : 'sem link') +
                ' · reação ' + d.evidence.reaction))))),
        ),
    r.buttons.length > 0 && h('details', {}, h('summary', { class: 'muted' }, `Botões visíveis (${r.buttons.length})`), h('div', { class: 'muted' }, r.buttons.join(' · '))),
  );
}

async function diagnosticsView(a) {
  const done = new Set(diagReports.filter((r) => r.accountId === a.id).map((r) => r.page));
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('strong', {}, 'Validar o app na sua conta, sem fazer nenhuma ação'),
      h('div', { class: 'muted' }, 'Com a conta iniciada e as campanhas pausadas, navegue você mesmo na janela do LinkedIn até cada página abaixo e clique em "Diagnosticar página aberta". O app só lê a página: não clica, não digita e não navega. No fim, salve o relatório (os nomes das pessoas são removidos) e envie para ajuste dos seletores.'),
      h('ol', { style: 'margin:0;padding-left:20px' }, ...DIAG_PAGES.map(([k, txt, what]) => h('li', {}, txt, h('span', { class: 'muted' }, ` — verifica ${what}${done.has(k) ? ' ✓' : ''}`)))),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !a.running, onclick: async (e) => {
          e.target.disabled = true;
          const r = await safe(() => api.diagnose(a.id));
          if (r) {
            diagReports.push({ ...r, accountId: a.id });
            const req = r.keys.filter((k) => !k.conditional);
            const ok = req.filter((k) => k.found).length;
            toast(r.page === 'outra' ? 'Esta página não é usada pelo app. Abra uma das páginas da lista.' : `${r.page}: ${ok} de ${req.length} elementos obrigatórios encontrados`, 6000);
          }
          renderView();
        } }, 'Diagnosticar página aberta'),
        h('button', { disabled: !diagReports.length, onclick: () => safe(() => api.saveDiagnosis(diagReports.map(({ accountId, ...r }) => r))).then((p) => p && toast(`Relatório salvo em ${p}`, 7000)) }, `Salvar relatório (${diagReports.length})`),
        !a.running && h('span', { class: 'muted' }, 'Inicie a conta para abrir a janela do LinkedIn.')),
    ),
    ...diagReports.map((r, i) => (r.accountId === a.id ? diagReportCard(r, i) : null)).filter(Boolean).reverse(),
  );
}
