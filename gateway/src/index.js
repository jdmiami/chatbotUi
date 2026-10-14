import os from 'node:os';
import path from 'node:path';
import { createGateway, loadConfig } from './server.js';

const config = loadConfig();
const log = console;

// Orbit host (real terminal, files and Antigravity for the Orbit workspace) is opt-in.
let orbit = null;
if (/^(1|true|yes)$/i.test(process.env.ORBIT_HOST || '')) {
  const { FileService } = await import('./orbit/files.js');
  const { AgentService } = await import('./orbit/agent.js');
  const { createOrbitApi } = await import('./orbit/http.js');
  const { ORBIT_SEED } = await import('./orbit/seed.js');
  const home = os.homedir();
  const projectsDir = process.env.ORBIT_PROJECTS_DIR || path.join(home, 'projects');
  const files = new FileService(projectsDir);
  await files.init(ORBIT_SEED);
  const agent = new AgentService({
    dataFile: path.join(process.env.ORBIT_DATA_DIR || path.join(home, '.orbit'), 'agent.json'),
    projectsDir,
    agyPath: process.env.AGY_PATH || path.join(home, '.local/bin/agy'),
    log,
  });
  await agent.init();
  orbit = {
    api: createOrbitApi({ secret: config.secret, allowedOrigins: config.allowedOrigins, files, agent, log }),
    pty: { cwd: projectsDir },
  };
  log.info(`[orbit] host enabled: projects at ${projectsDir}`);
}

const server = createGateway(config, log, orbit);

server.listen(config.port, () => {
  console.log(`[gateway] listening on :${config.port}, guacd at ${config.guacd.host}:${config.guacd.port}`);
  if (!config.allowedOrigins.length) {
    console.warn('[gateway] ALLOWED_ORIGINS is empty: any website may open a tunnel with a valid token');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
