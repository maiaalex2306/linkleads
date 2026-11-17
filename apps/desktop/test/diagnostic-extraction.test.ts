import { describe, expect, it } from 'vitest';
import { postInventoryPrimaryCode } from '../src/main/linkedin/diagnostics-policy.js';

describe('classificacao da leitura de publicacoes no diagnostico', () => {
  it('nao confunde falha de extracao do DOM com ausencia de cartoes', () => {
    expect(postInventoryPrimaryCode({
      isActivity: true, extractionFailed: true, recognized: 0, reviewCodes: [],
    })).toBe('DOM_EXTRACTION_ERROR');
  });

  it('preserva CARD_NOT_FOUND quando a leitura ocorreu sem identificar posts', () => {
    expect(postInventoryPrimaryCode({
      isActivity: true, extractionFailed: false, recognized: 0, reviewCodes: [],
    })).toBe('CARD_NOT_FOUND');
  });

  it('preserva o bloqueio de URN provisoria quando houve reconhecimento parcial', () => {
    expect(postInventoryPrimaryCode({
      isActivity: true, extractionFailed: false, recognized: 2,
      reviewCodes: ['CARD_ID_PROVISIONAL'],
    })).toBe('CARD_ID_PROVISIONAL');
  });

  it('nao atribui erro de posts a uma pagina de perfil', () => {
    expect(postInventoryPrimaryCode({
      isActivity: false, extractionFailed: false, recognized: 0, reviewCodes: [],
    })).toBe('OK');
  });

  it('a falha de extracao prevalece sobre contagens parciais ou classificacoes antigas', () => {
    expect(postInventoryPrimaryCode({
      isActivity: true, extractionFailed: true, recognized: 1,
      reviewCodes: ['POST_ELIGIBLE'],
    })).toBe('DOM_EXTRACTION_ERROR');
  });
});
