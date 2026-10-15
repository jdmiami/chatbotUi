# Orbit — tasks

Status legend: ✅ done · 🔄 in progress · ⏳ pending · ⛔ blocked (with the missing dependency)

## Phase 1 — interactive prototype

- ✅ Stack: Vite + React + TypeScript, zustand, xterm.js, CodeMirror 6, Vitest, Playwright (Chromium emulation).
- ✅ Shell: home, dock, keep-alive app host, App Switcher, Control Center, iPad split view, first-run sheet,
  toasts, keyboard shortcuts, visual-viewport keyboard handling.
- ✅ Terminal (simulated shell), Code (CodeMirror 6, browser storage), Antigravity (demo runner), Settings.
- ✅ Verification: unit tests and Playwright on iPhone 14 Pro Max and iPad Pro 11 (portrait and landscape).

## Phase 2 — real Linux machine

- ✅ One link: sign in → choose Orbit / Linux desktop / Windows PC, choice remembered, switch any time.
- ✅ Machine power from the site (Runpod API; the key stays on the server).
- ✅ Orbit host on the machine: token auth, files API with conflict detection, tmux-backed terminals with
  shared sizing and history, agy runner with sessions stored on the machine.
- ✅ Real adapters in Orbit: `PtyBackend`, `ServerFileStore`, `HostRunner` (re-attaches after a dropped stream).
- ✅ Clear screens when the machine is off, starting or unreachable; demo mode always available.
- ✅ Gateway tests (fake agy) and browser checks against a local copy of the machine's service with real agy.
- 🔄 Final check on the real Runpod machine after this release, then production deploy.

## Later

- ⏳ Optional: scoped `permissions.allow` defaults for agy tools (owner decision).
- ⏳ Optional: live agy output via `stream-json` (needs a timed probe first).
- ⏳ Optional: run the machine service as its own user, separate from `desktop`.
- ⏳ Recommended: turn on two-step sign-in (`TOTP_SECRET`) for the site.
