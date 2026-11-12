import type { Person } from '@linkleads/core';
import { memberIdFromSalesHash } from '@linkleads/core';

/**
 * Plano de abertura de perfil. As URLs são rotas documentadas de navegação, NÃO
 * uma conversão algorítmica de hash -> slug público. Cada tentativa deve ser
 * conferida contra identidade e página de destino antes de gravar publicId.
 */
export type IdentityRoute = 'exported_public_candidate' | 'sales_source' | 'sales_hash' | 'member_legacy';
export interface ProfileRoute {
  method: IdentityRoute;
  url: string;
  requiresNameConfirmation: boolean;
}

const linkedinHost = (host: string) => host === 'linkedin.com' || host.endsWith('.linkedin.com');

export function safePublicId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const id = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._%-]{1,119}$/i.test(id) && !/%(?:2f|5c|00)/i.test(id) ? id : undefined;
}

export function snHashCore(raw?: string): string | undefined {
  const core = raw?.trim().split(',')[0]?.trim();
  return core && /^[a-zA-Z0-9_-]{6,200}$/.test(core) ? core : undefined;
}

export function parseSalesSource(raw?: string): { url: string; core: string } | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !linkedinHost(url.hostname.toLowerCase())) return undefined;
    const m = url.pathname.match(/^\/sales\/(?:people|lead|profile)\/([a-zA-Z0-9_-]+)(?:,[a-zA-Z0-9_-]+)*\/?$/);
    if (!m) return undefined;
    const core = snHashCore(m[1]);
    if (!core) return undefined;
    return { url: url.origin + url.pathname + url.search, core };
  } catch { return undefined; }
}

/**
 * Não usar URL arbitrária, resultado de busca por nome nem endpoint interno
 * não documentado. Um ID numérico pode ser testado na rota histórica
 * /profile/view?id=..., mas sucesso é estabelecido APENAS por redirect /in/
 * + checagem de identidade.
 */
export function profileResolutionRoutes(p: Person): ProfileRoute[] {
  const routes: ProfileRoute[] = [];
  const candidate = safePublicId(p.custom?.linkleads_import_public_id_unverified);
  if (candidate && !p.publicId)
    routes.push({ method: 'exported_public_candidate',
      url: 'https://www.linkedin.com/in/' + encodeURIComponent(candidate) + '/',
      requiresNameConfirmation: true });
  const sales = parseSalesSource(p.custom?.linkleads_source_url);
  const hash = snHashCore(p.custom?.sn_id || p.custom?.linkleads_sn_hash_core);
  if (sales && (!hash || hash === sales.core))
    routes.push({ method: 'sales_source', url: sales.url, requiresNameConfirmation: false });
  if (!sales && hash)
    routes.push({ method: 'sales_hash',
      url: 'https://www.linkedin.com/sales/people/' + encodeURIComponent(hash) + '/',
      requiresNameConfirmation: true });
  const memberFromHash = memberIdFromSalesHash(hash ?? sales?.core);
  const suppliedMember = p.memberId?.trim();
  // Nunca misturar identificadores inconsistentes na mesma pessoa.
  if (memberFromHash && suppliedMember && suppliedMember !== memberFromHash) return [];
  const member = suppliedMember ?? memberFromHash;
  if (member && /^\d{1,20}$/.test(member))
    routes.push({ method: 'member_legacy',
      url: 'https://www.linkedin.com/profile/view?id=' + member,
      requiresNameConfirmation: false });
  // Uma conta Basic pode levar /sales/ para login/authwall. Preferir a
  // rota pública legada por member_id antes do Sales Navigator; não evita
  // checkpoint e não altera as permissões da plataforma.
  const priority: Record<IdentityRoute, number> = {
    exported_public_candidate: 0, member_legacy: 1, sales_source: 2, sales_hash: 3,
  };
  return routes.filter((route, index, all) => all.findIndex((x) => x.url === route.url) === index)
    .sort((a, b) => priority[a.method] - priority[b.method]);
}

/** Não comparar identidade exclusivamente por homônimos. A conferência de nome
 * é uma confirmação adicional, não substitui uma rota vinculada ao membro.
 */
export function samePersonName(expected: Person, observed: string | null | undefined): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const first = fold(expected.firstName ?? '').split(' ')[0];
  const last = fold(expected.lastName ?? '');
  const name = fold(observed ?? '');
  if (!name || !first || !last) return false;
  const pieces = name.split(' ');
  const lastPiece = last.split(' ').filter(Boolean).at(-1);
  return pieces[0] === first && !!lastPiece && pieces.includes(lastPiece);
}
