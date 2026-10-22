/** The studios that exist, by id (each one's site, look and questions live in Orbit's studio/). */
const STUDIOS: Record<string, { name: string; line: string }> = {
  afterdark: { name: 'After Dark', line: 'Adults only. Sign in to your studio.' },
};

export function studioName(id: string): string | null {
  return STUDIOS[id]?.name ?? null;
}

export function studioLine(id: string): string {
  return STUDIOS[id]?.line ?? '';
}
