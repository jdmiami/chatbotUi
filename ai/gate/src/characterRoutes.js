// The owner's routes for characters (characters.js), under /_orbit/studio/characters. The gate
// (gate.js) hands requests here after it has seen who is asking.
//
//   GET    /characters                 the library (with pictures' links)
//   POST   /characters                 create from words: { name, age, traits, idea? }
//   POST   /characters/check           check words without saving: { problem: string | null }
//   GET    /characters/:id             one character
//   PUT    /characters/:id             change it (name, age, traits)
//   DELETE /characters/:id             delete it (the creations made with it stay)
//   POST   /characters/:id/rename      { name }
//   POST   /characters/:id/duplicate
//   POST   /characters/:id/accept      the sheet is good: the character can be used
//   GET    /characters/:id/sheet       how the sheet is coming along
//   POST   /characters/:id/sheet       start or carry on: { views?, extras?, redo? }
//   POST   /characters/:id/sheet/stop
//   POST   /characters/:id/sheet/:view make one view again
//   GET    /characters/file/:id/:name  a sheet picture (a signed-in request, or a link with ?t=)

const BASE = '/_orbit/studio/characters';

export function createCharacterRoutes({ characters, send, readBody, sendFile, fileToken, fileTokenOk, activity = () => {} }) {
  const fileSub = (id, name) => `c:${id}/${name}`;
  const withUrls = (c) =>
    c
      ? {
          ...c,
          sheet: (c.sheet || []).map((e) => {
            const name = e.file.split('/').pop();
            return { ...e, url: `${BASE}/file/${c.id}/${name}?t=${fileToken(fileSub(c.id, name))}` };
          }),
        }
      : c;

  /** Returns true when the request was for characters (and has been answered). */
  return async function handle(req, res, url, path, { signedIn }) {
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return false;
    const rest = path.slice(BASE.length).split('/').filter(Boolean);
    try {
      // A sheet picture: a signed-in request, or a link made for it.
      if (rest[0] === 'file' && rest.length === 3 && (req.method === 'GET' || req.method === 'HEAD')) {
        const [, id, name] = rest;
        if (!signedIn && !fileTokenOk(url.searchParams.get('t'), fileSub(id, name))) return send(res, 401, { error: 'Unauthorized' }), true;
        sendFile(req, res, await characters.file(id, name), url.searchParams.has('download'));
        return true;
      }
      if (!signedIn) return send(res, 401, { error: 'Unauthorized' }), true;
      if (req.method !== 'GET' && req.method !== 'HEAD') activity();
      const body = async () => JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      const ok = (value, code = 200) => (send(res, code, value), true);

      if (rest.length === 0) {
        if (req.method === 'GET') return ok({ characters: (await characters.list()).map(withUrls) });
        if (req.method === 'POST') return ok({ character: withUrls(await characters.create(await body())) }, 201);
        return ok({ error: 'Not allowed' }, 405);
      }
      if (rest[0] === 'check' && rest.length === 1 && req.method === 'POST') {
        const input = await body();
        return ok({ problem: characters.check(input) });
      }
      const id = rest[0];
      if (rest.length === 1) {
        if (req.method === 'GET') return ok({ character: withUrls(await characters.view(id)) });
        if (req.method === 'PUT') return ok({ character: withUrls(await characters.update(id, await body())) });
        if (req.method === 'DELETE') {
          const gone = await characters.remove(id);
          return ok({ ok: true }, gone ? 200 : 404);
        }
        return ok({ error: 'Not allowed' }, 405);
      }
      if (rest.length === 2 && req.method === 'POST') {
        if (rest[1] === 'rename') return ok({ character: withUrls(await characters.rename(id, (await body()).name)) });
        if (rest[1] === 'duplicate') return ok({ character: withUrls(await characters.duplicate(id)) }, 201);
        if (rest[1] === 'accept') return ok({ character: withUrls(await characters.accept(id)) });
      }
      if (rest[1] === 'sheet') {
        if (rest.length === 2 && req.method === 'GET') return ok({ run: await characters.sheet(id), character: withUrls(await characters.view(id)) });
        if (rest.length === 2 && req.method === 'POST') {
          const b = await body();
          const run = await characters.startSheet(id, { views: b.views, extras: b.extras !== false, redo: Boolean(b.redo) });
          return ok({ run });
        }
        if (rest.length === 3 && req.method === 'POST' && rest[2] === 'stop') return ok({ run: await characters.stop(id) });
        if (rest.length === 3 && req.method === 'POST') return ok({ run: await characters.regenerate(id, rest[2]) });
      }
      return ok({ error: 'Not found' }, 404);
    } catch (err) {
      const code = err.status || (err instanceof SyntaxError ? 400 : 500);
      send(res, code, { error: err.message, blocked: Boolean(err.blocked) });
      return true;
    }
  };
}
