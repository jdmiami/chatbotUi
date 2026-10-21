import os from 'node:os';
import path from 'node:path';
import { createGateway, loadConfig } from './server.js';
import { cliAgentRunning } from './idle.js';
import { clampAutoOffMinutes, createAutoOff, runpodStopSelf } from '../../shared/autooff.js';

const config = loadConfig();
const log = console;

// The one auto-off rule (shared/autooff.js), the same as the AI machine's: off after IDLE_MINUTES
// without touch, mouse or keyboard input while no Antigravity turn or Claude Code task runs. The site
// sends its AUTO_OFF_MINUTES as IDLE_MINUTES; never more than an hour and never 0 (the money fail-safe).
// "Keep on" (POST /keepawake) holds it on longer, within the same limits.
const idle = createAutoOff({
  limitMinutes: clampAutoOffMinutes(process.env.IDLE_MINUTES),
  busy: async () => Boolean(orbit?.agent.running.size) || (await cliAgentRunning()),
  stop: () => runpodStopSelf({ podId: process.env.RUNPOD_POD_ID, apiKey: process.env.RUNPOD_API_KEY }),
  log,
  tag: '[idle]',
});

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
  // OpenClaw (when installed on this machine): Orbit's agent screen talks to it through the gateway.
  let claw = null;
  if (process.env.CLAW_URL && process.env.CLAW_TOKEN_FILE) {
    const { ClawService } = await import('./orbit/claw.js');
    const dataDir = process.env.ORBIT_DATA_DIR || path.join(home, '.orbit');
    claw = new ClawService({
      url: process.env.CLAW_URL,
      tokenFile: process.env.CLAW_TOKEN_FILE,
      identityFile: path.join(dataDir, 'claw-device.json'),
      dataFile: path.join(dataDir, 'claw.json'),
      projectsDir,
      models: [
        { id: 'orbit/qwen3.6:35b', label: 'Your AI machine (Qwen 3.6 35B)' },
        { id: 'orbit-cloud/orbit-agent', label: 'Cloud AI (works with the AI machine off)' },
      ],
      log,
    });
    await claw.init();
    log.info(`[orbit] OpenClaw at ${process.env.CLAW_URL}`);
  }
  orbit = {
    agent,
    api: createOrbitApi({ secret: config.secret, allowedOrigins: config.allowedOrigins, files, agent, claw, log, onInput: () => idle.activity() }),
    pty: { cwd: projectsDir },
  };
  log.info(`[orbit] host enabled: projects at ${projectsDir}`);
}

// The web app's address: the first plain (non-wildcard) allowed origin, unless SITE_URL says otherwise.
const siteUrl = (process.env.SITE_URL || config.allowedOriginsRaw.find((o) => !o.includes('*')) || '').replace(/\/$/, '');

// Coding workspace (VS Code in the browser at /code/) when code-server runs on this machine.
let code = null;
if (process.env.CODE_SERVER_URL) {
  const { createCodeProxy } = await import('./code.js');
  code = createCodeProxy({ secret: config.secret, upstream: process.env.CODE_SERVER_URL, siteUrl, log, onInput: () => idle.activity() });
  log.info(`[code] VS Code at /code/ -> ${process.env.CODE_SERVER_URL}`);
}

// Local model endpoint for the coding agent (127.0.0.1 only): forwards to the AI machine.
if (process.env.AI_LOCAL_PORT && siteUrl) {
  const { createLocalAiProxy } = await import('./ai-local.js');
  createLocalAiProxy({ secret: config.secret, siteUrl, log }).listen(Number(process.env.AI_LOCAL_PORT), '127.0.0.1', () =>
    log.info(`[ai-local] model endpoint on 127.0.0.1:${process.env.AI_LOCAL_PORT}/v1 (via ${siteUrl})`),
  );
}

const server = createGateway(config, log, orbit, code, idle);
idle.start();

server.listen(config.port, () => {
  console.log(`[gateway] listening on :${config.port}, guacd at ${config.guacd.host}:${config.guacd.port}`);
  if (!config.allowedOrigins.length) {
    console.warn('[gateway] ALLOWED_ORIGINS is empty: any website may open a tunnel with a valid token');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
