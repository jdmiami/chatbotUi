# Orbit — tasks

Status legend: ✅ done · 🔄 in progress · ⏳ pending · ⛔ blocked (with the missing dependency)

## Phase 1 — interactive prototype

- ✅ Workspace inspection. The reference prototype at `orbit-ubuntu-shell.johnnyfama.chatgpt.site` returns HTTP 401 (owner login), so it was not inspected; built from the brief.
- ✅ Stack decision: Vite + React + TypeScript, zustand, xterm.js, CodeMirror 6, Vitest, Playwright (Chromium emulation).
- ✅ Foundation: design tokens (dark/light, 5 accents, 4 wallpapers), shell (home, dock, keep-alive app host, App Switcher, Control Center, iPad split view, first-run disclosure, toasts, shortcuts), visual-viewport keyboard handling, shared UI kit.
- ✅ Integration seams: `TerminalBackend`, `FileStore`, `RunnerAdapter` + `agyCapabilities.ts`; browser-local file store with demo project.
- 🔄 Terminal app + simulated shell
- 🔄 Code app (CodeMirror 6)
- 🔄 Antigravity app + demo runner
- 🔄 Settings app
- 🔄 Phase 2 research → `docs/ARCHITECTURE.md`
- ⏳ Verification: unit tests, Playwright on 4 emulated viewports, screenshot / accessibility / Safari-risk review, fixes
- ⏳ README, preview, PR

## Phase 2 — real Ubuntu session (not started)

- ⛔ Needs from the owner: see "Minimum information for Phase 2" in `docs/ARCHITECTURE.md`.

## Phase 3 — reproducible installation (not started)
