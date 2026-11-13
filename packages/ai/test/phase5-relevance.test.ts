import { describe, expect, it } from 'vitest';
import { groundedTerms, hasSufficientPostText, sanitize, validatePostInterpretation,
  type PostInterpretation } from '../src/index.js';

const post = {
  url: 'urn:li:activity:7381234567890129990',
  text: 'Concluímos a implantação da telemetria em 120 quilômetros de rede e reduzimos as perdas de água em 18% no trimestre.',
  hasMedia: false,
};
const valid = (): PostInterpretation => ({
  language: 'pt', summary: 'Telemetria e eficiência operacional',
  mainPoint: 'Monitoramento de perdas', authorWork: 'Gestão de rede',
  topics: ['telemetria', 'água'], postType: 'conteudo_tecnico', sentiment: 'positivo',
  sensitive: false, shouldComment: true, skipReason: '',
  comment: 'A aplicação de telemetria em redes de água merece atenção. Como estruturaram a medição?',
});

describe('Fase 5 — IA grounded e pertinência verificável', () => {
  it('não chama IA para texto vazio, curto ou marcador de truncamento', () => {
    expect(hasSufficientPostText('Muito bom!')).toBe(false);
    expect(hasSufficientPostText('Veja foto e link: https://example.com')).toBe(false);
    expect(hasSufficientPostText(post.text)).toBe(true);
    expect(hasSufficientPostText(post.text + ' … ver mais')).toBe(false);
  });
  it('reconhece tema comum à publicação sem depender de capitalização/acentos', () => {
    expect(groundedTerms('Telemetria e REDUÇÃO')).toEqual(new Set(['telemetria','reducao']));
    const result = validatePostInterpretation(post, valid());
    expect(result.shouldComment).toBe(true);
  });
  it('não aprova comentário genérico sem evidência temática do texto', () => {
    const result = validatePostInterpretation(post, { ...valid(),
      comment: 'Adorei demais, sucesso sempre e boas notícias para vocês!' });
    expect(result.shouldComment).toBe(false);
    expect(result.comment).toBe('');
    expect(result.skipReason).toMatch(/temática/);
  });
  it('rejeita percentuais e métricas fabricados por IA', () => {
    const result = validatePostInterpretation(post, { ...valid(),
      comment: 'A telemetria que reduziu 35% das perdas é uma referência.' });
    expect(result.shouldComment).toBe(false);
    expect(result.skipReason).toMatch(/números/);
    expect(validatePostInterpretation(post, { ...valid(),
      comment: 'A redução de 18% por telemetria é um resultado relevante.' }).shouldComment).toBe(true);
  });
  it('nunca publica comentário sensível e preserva limite máximo', () => {
    expect(sanitize({ ...valid(), sensitive: true }, 400).shouldComment).toBe(false);
    expect(sanitize({ ...valid(), comment: 'telemetria '.repeat(100) }, 80).shouldComment).toBe(false);
  });
});
