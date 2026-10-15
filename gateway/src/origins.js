/**
 * Which websites may talk to this gateway (ALLOWED_ORIGINS, comma-separated).
 *
 * An entry is an exact origin ("https://example.com") or a pattern with "*" standing for one
 * run of letters, digits and dashes inside a single hostname label, e.g.
 * "https://myapp-*-myteam.vercel.app" covers that project's own deployment and branch addresses
 * on Vercel but no other site ("*" never matches a dot, slash or colon).
 * An empty list allows any origin (a valid token is still required); production should set it.
 */
export function parseOrigins(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!entry.includes('*')) return { entry, test: (o) => o === entry };
      const escaped = entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`^${escaped.join('[a-z0-9-]+')}$`);
      return { entry, test: (o) => re.test(o) };
    });
}

export function originAllowed(origin, allowed) {
  if (!allowed.length) return true;
  if (!origin) return false;
  return allowed.some((a) => a.test(origin));
}
