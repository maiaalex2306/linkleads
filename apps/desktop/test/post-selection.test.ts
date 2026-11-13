import { describe, expect, it } from 'vitest';
import { pickPost, choosePost, firstUnlikedCandidate, hasNewVerifiedPost, profileSlug, sameConfirmedPublicId } from '../src/main/linkedin/executors.js';
import type { PostExtract } from '../src/main/linkedin/dom-scripts.js';

const one = (urn: string, liked: boolean | null): PostExtract => ({
  urn, text: 'Publicação sobre infraestrutura e operação hídrica',
  actorHref: 'https://www.linkedin.com/in/ana-silva/',
  actorName: 'Ana Silva', age: '2 d', hasMedia: false, isReshare: false,
  liked,
});
describe('primeira publicação não curtida — ordem da tela, independente da data e URN', () => {
  it('pula as curtidas e escolhe exatamente a primeira não curtida', () => {
    const posts = [
      one('urn:li:activity:111111111111', true),
      { ...one('ll-idx-0', false), age: null },
      one('urn:li:activity:222222222222', false),
    ];
    expect(firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva').post?.urn).toBe('ll-idx-0');
  });
  it('pula um cartão já curtido mesmo se estiver sem autor legível', () => {
    const posts = [
      { ...one('ll-idx-0', true), actorHref: null, actorName: null },
      one('urn:li:activity:222222222222', false),
    ];
    expect(firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva').post?.urn)
      .toBe('urn:li:activity:222222222222');
  });
  it('não exige texto no cartão para considerar um post ainda não curtido', () => {
    const p = { ...one('urn:li:activity:222222222222', false), text: '', hasMedia: true };
    expect(firstUnlikedCandidate([p], 'ana-silva', 'Ana Silva').post?.urn).toBe(p.urn);
  });
  it('não escolhe post de outro autor e não muda a ordem por idade', () => {
    const posts = [
      { ...one('urn:li:activity:111111111111', false), actorHref: 'https://www.linkedin.com/in/outro/' },
      { ...one('urn:li:activity:222222222222', false), age: '150 d' },
      { ...one('urn:li:activity:333333333333', false), age: '1 d' },
    ];
    expect(firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva').post?.urn)
      .toBe('urn:li:activity:222222222222');
  });
  it('não presume que estado de curtida desconhecido seja não curtido', () => {
    const posts = [one('urn:li:activity:111111111111', null), one('urn:li:activity:222222222222', false)];
    const selected = firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva');
    expect(selected.post?.urn).toBe('urn:li:activity:111111111111');
    expect(selected.uncertain).toBe(true);
    expect(selected.why).toMatch(/estado de reação desconhecido/);
  });
  it('não atribui post sem autoria conhecida à conta por suposição', () => {
    const posts = [{ ...one('ll-idx-0', false), actorHref: null, actorName: null }];
    expect(firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva').uncertain).toBe(true);
  });
  it('pode ignorar repost de terceiro quando não está configurado', () => {
    const posts = [
      { ...one('urn:li:activity:111111111111', false), isReshare: true },
      one('urn:li:activity:222222222222', false),
    ];
    expect(firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva').post?.urn)
      .toBe('urn:li:activity:222222222222');
  });
});

describe('escolha de publicação com confirmação do estado', () => {
  it('ignora publicações curtidas e encontra a próxima ainda não curtida', () => {
    const posts = [
      one('urn:li:activity:111111111111', true),
      one('urn:li:activity:222222222222', false),
    ];
    expect(pickPost(posts, 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva')?.urn)
      .toBe('urn:li:activity:222222222222');
  });
  it('não escolhe publicação quando todas já foram curtidas', () => {
    const posts = [one('urn:li:activity:111111111111', true)];
    const selection = choosePost(posts, 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva');
    expect(selection.post).toBeUndefined();
    expect(selection.why).toMatch(/já foram curtidas/);
  });
  it('ação composta pode comentar post já curtido sem repetir a curtida', () => {
    const posts = [one('urn:li:activity:111111111111', true)];
    const chosen = choosePost(posts, 'ana-silva',
      { maxPostAgeDays: 30, allowAlreadyLiked: true }, 'Ana Silva');
    expect(chosen.post?.urn).toBe('urn:li:activity:111111111111');
    expect(chosen.post?.liked).toBe(true);
  });
  it('prioriza um post ainda não curtido mesmo se permitir um já curtido', () => {
    const posts = [one('urn:li:activity:111111111111', true),
      one('urn:li:activity:222222222222', false)];
    expect(choosePost(posts, 'ana-silva',
      { maxPostAgeDays: 30, allowAlreadyLiked: true }, 'Ana Silva').post?.urn)
      .toBe('urn:li:activity:222222222222');
  });
  it('não confunde homônimos nem usa apenas o sobrenome', () => {
    const posts = [{ ...one('urn:li:activity:444444444444', false),
      actorHref: 'https://www.linkedin.com/in/maria-silva/',
      actorName: 'Maria Silva' }];
    const chosen = choosePost(posts, 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva');
    expect(chosen.post).toBeUndefined();
    expect(chosen.why).toMatch(/outro autor/);
  });
  it('identidade do autor desconhecida gera diagnóstico e nunca NO_POST por padrão', () => {
    const posts = [{ ...one('urn:li:activity:555555555555', false),
      actorHref: null, actorName: null }];
    const chosen = choosePost(posts, 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva');
    expect(chosen.post).toBeUndefined();
    expect(chosen.uncertain).toBe(true);
    expect(chosen.why).toMatch(/identidade do autor/);
  });
  it('não atribui autoria por nome completo: homônimos também têm nomes iguais', () => {
    const posts = [{ ...one('urn:li:activity:666666666666', false),
      actorHref: null, actorName: 'Ana Silva' }];
    const selected = choosePost(posts, 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva');
    expect(selected.post).toBeUndefined();
    expect(selected.uncertain).toBe(true);
    expect(selected.why).toMatch(/identidade do autor/);
    expect(firstUnlikedCandidate(posts, 'ana-silva', 'Ana Silva').uncertain).toBe(true);
  });
  it('estado de curtida desconhecido é identificado como candidato de diagnóstico, nunca sucesso automático', () => {
    const p = one('urn:li:activity:333333333333', null);
    expect(pickPost([p], 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva')?.liked).toBeNull();
  });
  it('365 dias é um limite inclusivo, mas 366 dias não é elegível', () => {
    const within = { ...one('urn:li:activity:777777777777', false), age: '365 d' };
    const outside = { ...one('urn:li:activity:888888888888', false), age: '366 d' };
    expect(choosePost([within], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva').post?.urn)
      .toBe(within.urn);
    const rejected = choosePost([outside], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva');
    expect(rejected.post).toBeUndefined();
    expect(rejected.why).toMatch(/mais de 365 dias/);
  });
  it('não descarta publicações de 90 e 150 dias quando o limite efetivo é um ano', () => {
    const p90 = { ...one('urn:li:activity:999999999990', false), age: '90 d' };
    const p150 = { ...one('urn:li:activity:999999999991', false), age: '150 d' };
    expect(choosePost([p90, p150], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva').post)
      .toBeDefined();
    expect(choosePost([p90, p150], 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva').post)
      .toBeUndefined();
  });


  it('não aceita URN sintética apesar de haver autor, idade e texto', () => {
    const p = one('ll-idx-0', false);
    const result = choosePost([p], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva');
    expect(result.post).toBeUndefined();
    expect(result.uncertain).toBe(true);
    expect(result.why).toMatch(/URN provisória/);
  });
  it('não aceita data ausente ou ilegível, nem classifica como nenhum post', () => {
    for (const age of [null, '', 'sem data']) {
      const p = { ...one('urn:li:activity:999999999999', false), age };
      const result = choosePost([p], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva');
      expect(result.post).toBeUndefined();
      expect(result.uncertain).toBe(true);
      expect(result.why).toMatch(/data não verificável/);
    }
  });
  it('mostra por que as publicações reais não podem receber interação', () => {
    const posts = [
      one('ll-idx-0', false),
      { ...one('urn:li:activity:999999999997', false), age: 'sem data' },
    ];
    const result = choosePost(posts, 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva');
    expect(result.post).toBeUndefined();
    expect(result.uncertain).toBe(true);
    expect(result.why).toMatch(/1 com URN provisória/);
    expect(result.why).toMatch(/1 com data não verificável/);
  });

  it('preserva uma publicação válida mesmo quando outra tem identidade incerta', () => {
    const broken = { ...one('ll-idx-2', false), age: '2 d' };
    const valid = { ...one('urn:li:activity:999999999998', false), age: '90 d' };
    const result = choosePost([broken, valid], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva');
    expect(result.post?.urn).toBe(valid.urn);
  });

  it('prefixo Atividades no título não altera a autoria confirmada por URL', () => {
    const post = { ...one('urn:li:activity:777777777778', false),
      actorHref: 'https://www.linkedin.com/in/ana-silva/', actorName: 'Ana Silva', age: '150 d' };
    const result = choosePost([post], 'ana-silva',
      { maxPostAgeDays: 365 }, 'Atividades | Ana Silva');
    expect(result.post?.urn).toBe(post.urn);
  });

});


describe('autoria por URL pública opaca sensível a maiúsculas', () => {
  const opaque = 'ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc';
  const otherCase = 'ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hC';
  const original = one('urn:li:activity:7777777777001', false);
  const post = { ...original, actorHref: 'https://www.linkedin.com/in/' + opaque + '/' };

  it('admite autor ACo quando identificador é exatamente o perfil já resolvido', () => {
    expect(profileSlug(post.actorHref!)).toBe(opaque);
    expect(firstUnlikedCandidate([post], opaque).post?.urn).toBe(post.urn);
    expect(choosePost([post], opaque, { maxPostAgeDays: 30 }).post?.urn).toBe(post.urn);
  });

  it('não troca autor quando somente a caixa de caracteres do identificador difere', () => {
    expect(sameConfirmedPublicId(opaque, otherCase)).toBe(false);
    expect(sameConfirmedPublicId(opaque, opaque)).toBe(true);
    expect(firstUnlikedCandidate([post], otherCase).post).toBeUndefined();
    const chosen = choosePost([post], otherCase, { maxPostAgeDays: 30 });
    expect(chosen.post).toBeUndefined();
    expect(chosen.uncertain).toBe(true);
    expect(chosen.why).toMatch(/identidade do autor/);
  });

  it('continua rejeitando homônimo cujo link de autor não é o do lead', () => {
    const different = { ...post, actorHref: 'https://www.linkedin.com/in/outro-autor/' };
    expect(choosePost([different], opaque, { maxPostAgeDays: 30 }).post).toBeUndefined();
  });
});

describe('fase 3 — origem do autor e rolagem sem falsas identidades', () => {
  it('identificador interno no link de autor não pode ser promovido a identidade pública por coincidência de nome', () => {
    const p = { ...one('urn:li:activity:7381234567890128002', false),
      actorHref: 'https://www.linkedin.com/in/ACwAAAIATasBA/', actorName: 'Ana Silva' };
    const selected = choosePost([p], 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva');
    expect(selected.post).toBeUndefined();
    expect(selected.uncertain).toBe(true);
    expect(firstUnlikedCandidate([p], 'ana-silva', 'Ana Silva').uncertain).toBe(true);
  });

  it('um link externo /in/ não comprova a autoria mesmo com nome coincidente', () => {
    const bad = { ...one('urn:li:activity:1111111111111111111', false),
      actorHref: 'https://outro-exemplo.com/in/ana-silva/' };
    expect(profileSlug(bad.actorHref)).toBeUndefined();
    const first = firstUnlikedCandidate([bad], 'ana-silva', 'Ana Silva');
    expect(first.uncertain).toBe(true);
    expect(first.why).toMatch(/confiável/);
    const selected = choosePost([bad], 'ana-silva', { maxPostAgeDays: 365 }, 'Ana Silva');
    expect(selected.post).toBeUndefined();
    expect(selected.uncertain).toBe(true);
  });

  it('índice ll-idx-0 repetido nunca significa nova publicação', () => {
    const known = new Map<string, PostExtract>([
      ['unresolved:0:0', one('ll-idx-0', null)],
      ['urn:li:activity:1111111111111111111', one('urn:li:activity:1111111111111111111', true)],
    ]);
    expect(hasNewVerifiedPost(known, [one('ll-idx-0', null)])).toBe(false);
    expect(hasNewVerifiedPost(known, [one('urn:li:activity:1111111111111111111', true)])).toBe(false);
    expect(hasNewVerifiedPost(known, [one('urn:li:activity:2222222222222222222', false)])).toBe(true);
  });

  it('não aceita perfil com caminho codificado ou protocolo inseguro', () => {
    for (const url of [
      'https://fake-linkedin.com/in/ana-silva/',
      'http://www.linkedin.com/in/ana-silva/',
      'https://www.linkedin.com/in/ana%2Fsilva/',
    ]) expect(profileSlug(url)).toBeUndefined();
  });
});
