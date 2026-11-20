import { describe, expect, it } from 'vitest';
import { matchHydratedPost } from '../src/main/linkedin/post-identity.js';
const card = (o: Partial<{urn:string; text:string; age:string|null; actorHref:string|null; isReshare:boolean}> = {}) => ({
  urn:'ll-vcard:renan:aaaaaaaaaaaaaaaa',
  text:'Publicação institucional de Renan, exemplo de conteúdo único e extenso.',
  age:'há 2 d' as string|null,
  actorHref:'https://www.linkedin.com/in/renan/' as string|null,
  isReshare:false,
  ...o,
});
describe('0.5.22 revisado — vínculo seguro após re-hidratação', () => {
  it('reassocia apenas uma publicação com mesmo conteúdo, autor e idade', () => {
    const original=card();const fresh=card({urn:'ll-vcard:renan:bbbbbbbbbbbbbbbb'});
    expect(matchHydratedPost(original,[fresh])?.urn).toBe(fresh.urn);
  });
  it('não reassocia quando idade ou autoria deixam de aparecer', () => {
    const original=card();
    expect(matchHydratedPost(original,[card({age:null})])).toBeUndefined();
    expect(matchHydratedPost(original,[card({actorHref:null})])).toBeUndefined();
  });
  it('não adivinha a publicação quando o autor muda ou surgem duplicatas', () => {
    const original=card();
    expect(matchHydratedPost(original,[card({actorHref:'https://www.linkedin.com/in/outra/'})])).toBeUndefined();
    expect(matchHydratedPost(original,[card(),card()])).toBeUndefined();
  });
  it('não promove metadados inexistentes em um único lado a prova de identidade', () => {
    expect(matchHydratedPost(card({age:null}),[card()])).toBeUndefined();
    expect(matchHydratedPost(card({actorHref:null}),[card()])).toBeUndefined();
  });
});
