import type { RunnerAdapter, RunnerCapabilities, SendHandlers, RunHandle } from '../types';

/** PLACEHOLDER — replaced by the real demo runner. */
export class DemoRunner implements RunnerAdapter {
  readonly kind = 'demo' as const;
  readonly label = 'Demo runner — simulated replies';
  readonly capabilities = {} as RunnerCapabilities;
  async listProjects() { return []; }
  async listSessions() { return []; }
  async getSession() { return undefined; }
  async getTranscript() { return []; }
  async createSession(): Promise<never> { throw new Error('placeholder'); }
  async updateSession(): Promise<never> { throw new Error('placeholder'); }
  async deleteSession() {}
  async listModels() { return []; }
  send(_id: string, _t: string, h: SendHandlers): RunHandle { h.onError(new Error('placeholder')); return { stop() {} }; }
  subscribe() { return () => {}; }
  reset() {}
}
