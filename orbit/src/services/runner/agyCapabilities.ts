import type { RunnerCapabilities } from './types';

/**
 * Single source of truth for what the real Antigravity CLI (`agy`) can do, based on what we have
 * verified (agy 1.3.4: `agy --help`, official docs, and real runs — see docs/ARCHITECTURE.md).
 *
 * The demo runner reports these same capabilities so the Phase 1 UI shows exactly the controls
 * the Phase 2 adapter will have. Update this file only with verified facts.
 */
export const AGY_CAPABILITIES: RunnerCapabilities = {
  newConversation: {
    status: 'supported',
    note: 'Each new session starts a fresh `agy --print` conversation.',
  },
  continueConversation: {
    status: 'supported',
    note: 'Follow-ups pass `--conversation <id>`; verified that context carries over between turns.',
  },
  streamOutput: {
    status: 'unverified',
    note: '`--output-format stream-json` exists, but its event format has not been verified yet.',
  },
  stop: {
    status: 'supported',
    note: 'Stopping ends the running `agy` process. The turn is cancelled, not paused.',
  },
  pauseResume: {
    status: 'unsupported',
    note: 'agy documents no way to pause and later resume an in-flight turn.',
  },
  approvals: {
    status: 'unverified',
    note: 'Whether print mode can surface tool-approval requests to another program is not verified.',
  },
  modes: {
    status: 'supported',
    note: '`--mode plan` or `--mode accept-edits`; default omits the flag.',
  },
  models: {
    status: 'supported',
    note: '`agy models` lists the models your account can use; `--model <id>` selects one.',
  },
};
