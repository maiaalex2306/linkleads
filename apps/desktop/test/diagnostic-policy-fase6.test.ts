import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import type { SelectorMap } from '../src/main/linkedin/selectors.js';
import { PageDriver } from '../src/main/linkedin/page-driver.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyVerifiedSelectorOverride } from '../src/main/linkedin/selector-policy.js';
import { cardDecision, diagnosticPath, layoutShape, compareLayout, layoutHash } from '../src/main/linkedin/diagnostics-policy.js';
import { compareAndStoreBaseline } from '../src/main/linkedin/diagnostic-baselines.js';
import { evaluatePost } from '../src/main/linkedin/executors.js';
import type { PostExtract } from '../src/main/linkedin/dom-scripts.js';

const selectors: Record<string, unknown> = {
  version: '2026.11.13-fase6',
  postItem: ['.approved-a', '[data-urn]'],
  likeButton: ['button.react', 'button[aria-pressed]'],
  commentSubmit: ['button.approved-submit'],
  labels: { connect: '^(connect|conectar)$' },
};
const card = (overrides: Partial<PostExtract> = {}): PostExtract => ({
  urn: 'urn:li:activity:7381234567890129999',
  text: 'A engenharia de telemetria e gestão de perdas de água evoluiu no último trimestre.',
  actorHref: 'https://www.linkedin.com/in/ana-silva/', actorName: 'Ana Silva',
  age: '1 d', hasMedia: false, isReshare: false, liked: false,
  cardIdentity: {
    cardId: 'card-local', postUrn: 'urn:li:activity:7381234567890129999',
    permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:7381234567890129999/',
    primaryActorUrl: 'https://www.linkedin.com/in/ana-silva/',
    primaryActorName: 'Ana Silva', embeddedPostUrn: null, embeddedActorUrl: null,
    identityStatus: 'CONFIRMED',
  },
  postKind: 'ORIGINAL',
  ...overrides,
});
const shape = (overrides: Array<{ key: string; found: boolean; candidate: number | null }> = []) =>
  layoutShape({
    page: 'atividade', language: 'pt-BR',
    keys: overrides.length ? overrides : [
      { key: 'postItem', found: true, candidate: 0 },
      { key: 'likeButton', found: true, candidate: 1 },
      { key: 'commentEditor', found: false, candidate: null, conditional: true },
    ],
    structure: { hasMain: true, headings: [
      { tag: 'h2', classes: 'feed-title', parents: 'main.content' },
    ] },
  });

describe('Fase 6 — JSON externo nunca substitui seletores homologados por desconhecidos', () => {
  it('aceita apenas alternativas existentes e permite reorganizar a preferência', () => {
    const valid = applyVerifiedSelectorOverride(selectors, selectors,
      { version: 'v1', postItem: ['[data-urn]', '.approved-a'] }, 'selectors.json');
    expect(valid.accepted).toBe(true);
    expect(valid.selectors.postItem).toEqual(['[data-urn]', '.approved-a']);
    expect(valid.changedKeys).toEqual(['version', 'postItem']);
    expect(valid.issues).toEqual([]);
  });

  it('rejeita inteiro um override com chave inválida, sem mudar sequer a versão', () => {
    const bad = applyVerifiedSelectorOverride(selectors, selectors, {
      version: 'v2', likeButton: ['button.react'], postItem: ['button.unreviewed'],
    }, 'selectors.remote.json');
    expect(bad.accepted).toBe(false);
    expect(bad.issues).toContainEqual({ source: 'selectors.remote.json',
      code: 'UNAPPROVED_SELECTOR', key: 'postItem' });
    expect(bad.selectors).toBe(selectors);
  });

  it('bloqueia arquivo inválido, nomes desconhecidos e labels não homologados', () => {
    const bads = [
      { extra: ['.unapproved'] },
      { likeButton: [] },
      { likeButton: ['button.react', 'button.react'] },
      { labels: { connect: '.*' } },
      { version: '../../invalid' },
    ];
    for (const bad of bads)
      expect(applyVerifiedSelectorOverride(selectors, selectors, bad, 'selectors.json').accepted).toBe(false);
    expect(applyVerifiedSelectorOverride(selectors, selectors, null, 'selectors.json').issues[0]?.code)
      .toBe('INVALID_DOCUMENT');
  });
});

describe('Fase 6 — diagnóstico de cada cartão sem expor autoria ou conteúdo', () => {
  it('reutiliza decisão da seleção e preserva evidências sem URN, texto ou nomes', () => {
    const post = card();
    const decision = cardDecision(post, 1, evaluatePost(post, 'ana-silva'));
    expect(decision.code).toBe('POST_ELIGIBLE');
    expect(decision.status).toBe('ELIGIBLE');
    expect(decision.evidence.canonical).toBe(true);
    const json = JSON.stringify(decision);
    expect(json).not.toContain('ana-silva');
    expect(json).not.toContain('7381234567890129999');
    expect(json).not.toContain('telemetria');
  });

  it('não confunde autoria indeterminada, conflito de URN e reação desconhecida', () => {
    const wrongActor = card({ actorHref: null, cardIdentity: {
      ...card().cardIdentity!, primaryActorUrl: null,
    } });
    expect(cardDecision(wrongActor, 1, evaluatePost(wrongActor, 'ana-silva')).code)
      .toBe('AUTHOR_UNVERIFIED');
    const conflict = card({ cardIdentity: {
      ...card().cardIdentity!, identityStatus: 'CONFLICT',
    } });
    expect(cardDecision(conflict, 2, evaluatePost(conflict, 'ana-silva')).code)
      .toBe('CARD_ID_CONFLICT');
    const unknown = card({ liked: null });
    expect(cardDecision(unknown, 3, evaluatePost(unknown, 'ana-silva')).code)
      .toBe('REACTION_UNKNOWN');
  });

  it('não marca repostagem excluída como cartão ausente', () => {
    const repost = card({
      postKind: 'RESHARE_PLAIN', isReshare: true,
      resharedByHref: 'https://www.linkedin.com/in/ana-silva/',
    });
    const d = cardDecision(repost, 1, evaluatePost(repost, 'ana-silva', { includeReshares: false }));
    expect(d.code).toBe('RESHARE_EXCLUDED');
    expect(d.status).toBe('NOT_ELIGIBLE');
  });
});

describe('Fase 6 — comparação de contrato por layout/idioma', () => {
  it('não classifica variação de conteúdo como mudança de interface', () => {
    const base = shape();
    expect(compareLayout(base, shape())).toMatchObject({ status: 'MATCH', changedKeys: [] });
    expect(layoutHash(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detecta seleção alternativa homologada sem bloquear e controle obrigatório ausente com UI_CHANGED', () => {
    const base = shape();
    const alternate = shape([
      { key: 'postItem', found: true, candidate: 1 },
      { key: 'likeButton', found: true, candidate: 1 },
    ]);
    expect(compareLayout(base, alternate).status).toBe('DRIFT_DETECTED');
    const missing = shape([
      { key: 'postItem', found: true, candidate: 0 },
      { key: 'likeButton', found: false, candidate: null },
    ]);
    expect(compareLayout(base, missing)).toMatchObject({
      status: 'UI_CHANGED', changedKeys: ['likeButton'],
    });
  });

  it('salva só baseline saudável e nunca aceita drift automaticamente', () => {
    const root = mkdtempSync(join(tmpdir(), 'linkleads-fase6-baseline-'));
    try {
      const base = shape();
      const input = { page: 'atividade', uiLanguage: 'pt-BR', selectorVersion: 'v1', shape: base, healthy: false };
      expect(compareAndStoreBaseline(root, input).status).toBe('BASELINE_UNAVAILABLE');
      expect(compareAndStoreBaseline(root, { ...input, healthy: true }).status).toBe('BASELINE_CREATED');
      const changed = shape([
        { key: 'postItem', found: true, candidate: 0 },
        { key: 'likeButton', found: false, candidate: null },
      ]);
      expect(compareAndStoreBaseline(root, { ...input, shape: changed, healthy: false }).status).toBe('UI_CHANGED');
      expect(compareAndStoreBaseline(root, { ...input, healthy: true }).status).toBe('MATCH');
      const raw = readFileSync(join(root, 'diagnostic-baselines.v1.json'), 'utf8');
      expect(raw).not.toContain('ana-silva');
      expect(raw).not.toContain('urn:li');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('Fase 6 — contrato quebrado interrompe somente a etapa afetada', () => {
  it('UI_CHANGED bloqueia qualquer tentativa de clique no post antes de procurar botões', async () => {
    const wc = { getURL: () => 'https://www.linkedin.com/in/ana-silva/recent-activity/all/' };
    const driver = new PageDriver(wc as unknown as WebContents, selectors as unknown as SelectorMap);
    const scroll = vi.spyOn(driver, 'scrollIntoView');
    driver.setPageContractHealth('atividade', false);
    expect(await driver.clickVerifiedLike('urn:li:activity:7381234567890129999')).toBe('REVIEW_REQUIRED');
    expect(scroll).not.toHaveBeenCalled();
    driver.setPageContractHealth('atividade', true);
    // A liberação depende de nova leitura do alvo, nunca de clicar por suposição.
    scroll.mockResolvedValue(null);
    expect(await driver.clickVerifiedLike('urn:li:activity:7381234567890129999')).toBe('NOT_FOUND');
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

describe('Fase 6 — privacidade de links e URNs no diagnóstico', () => {
  it('remove URN, membros, empresas e identificadores de threads', () => {
    expect(diagnosticPath('https://www.linkedin.com/feed/update/urn:li:activity:7381234567890129999/?secret=1'))
      .toBe('/feed/update/[id]/');
    expect(diagnosticPath('https://www.linkedin.com/in/ana-silva/')).toBe('/in/[id]/');
    expect(diagnosticPath('https://www.linkedin.com/company/empresa-industrial/')).toBe('/company/[id]/');
    expect(diagnosticPath('https://www.linkedin.com/messaging/thread/abcdef12345/'))
      .toBe('/messaging/thread/[id]/');
  });
});
