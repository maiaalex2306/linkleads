import { describe, expect, it } from 'vitest';
import { pickPost, choosePost } from '../src/main/linkedin/executors.js';
import type { PostExtract } from '../src/main/linkedin/dom-scripts.js';

const one = (urn: string, liked: boolean | null): PostExtract => ({
  urn, text: 'Publicação sobre infraestrutura e operação hídrica',
  actorHref: 'https://www.linkedin.com/in/ana-silva/',
  actorName: 'Ana Silva', age: '2 d', hasMedia: false, isReshare: false,
  liked,
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
  it('aceita nome completo exatamente igual quando a página não informa o slug', () => {
    const posts = [{ ...one('urn:li:activity:666666666666', false),
      actorHref: null, actorName: 'Ana Silva' }];
    expect(choosePost(posts, 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva').post?.urn)
      .toBe('urn:li:activity:666666666666');
  });
  it('estado de curtida desconhecido é identificado como candidato de diagnóstico, nunca sucesso automático', () => {
    const p = one('urn:li:activity:333333333333', null);
    expect(pickPost([p], 'ana-silva', { maxPostAgeDays: 30 }, 'Ana Silva')?.liked).toBeNull();
  });
});
