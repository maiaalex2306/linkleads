/** Relógio do app. Em testes e2e (LINKLEADS_TEST_BASE_URL) pode ser adiantado para simular dias. */
let offsetMs = 0;

export const now = (): Date => new Date(Date.now() + offsetMs);

export function advanceClock(ms: number): void {
  if (!process.env.LINKLEADS_TEST_BASE_URL) throw new Error('Relógio só pode ser adiantado em modo de teste');
  offsetMs += ms;
}
