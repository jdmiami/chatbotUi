# Orbit — product spec

Orbit is a touch-first workspace for a personal cloud Ubuntu machine, used from **Safari on iPhone 14 Pro Max and
iPad Pro 11" (M2)**. It feels familiar to an iPhone/iPad user: app icons, a floating dock, a Control Center, an
App Switcher, full-screen apps on iPhone and an optional side-by-side split on iPad. The three primary apps
are **Terminal**, **Code** (editor) and **Antigravity** (chat and session manager for the Google Antigravity CLI, `agy`).

The Apple devices stay on iOS/iPadOS. Orbit runs in the browser; Ubuntu runs on a cloud server.

## Phases

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Interactive interface prototype on demo services, runnable with no cloud or AI account | Done (still available as **demo mode**) |
| 2 | Real Ubuntu session: authenticated PTY, real project files, real `agy` runner, shared state across devices | Built — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 3 | Reproducible install on a clean Ubuntu LTS host (installer / cloud-init, services, health, backup) | Partly: `linux/pod-setup.sh` installs everything on each start of the Runpod machine. Tested on that machine only; not a general-purpose installer |

## How it is reached

Orbit is one of the workspaces behind the site's single sign-in: sign in → choose **Orbit**, **Linux
desktop** or **Windows PC** (the choice can be remembered). Orbit is served at `/orbit` by the site and
talks directly to the Linux machine with a short-lived token. If the machine is off, Orbit offers to turn it
on (when the site has a Runpod API key) or to continue in demo mode.

## Phase 2 requirements (built)

- **Terminal:** a real login shell on the machine, kept alive in tmux so it survives closing the tab and
  can be resumed from another device; History view with the full scrollback as selectable text.
- **Code:** real project files under `~/projects` (on saved storage); saving never overwrites a file that
  changed elsewhere since it was opened (a conflict banner offers reload or overwrite); outside changes
  are picked up by polling.
- **Antigravity:** each message runs the real `agy` CLI once (`--print`, JSON output) in the project
  folder, continuing the same agy conversation; Stop ends the process; sessions and transcripts are stored
  on the machine and shared by every device; replies render a safe Markdown subset; signed-out agy, skipped
  tools and failures end the turn with a plain explanation. Never `--dangerously-skip-permissions`.
- **Honesty:** host mode shows "Linux machine" chips; demo mode keeps its "Demo"/"Simulated" labels.
  No invented health or resource figures.

## Users and devices

- One owner. Touch first, with optional hardware keyboard and trackpad (iPad Magic Keyboard).
- iPhone 14 Pro Max: 430×932 CSS px portrait, 932×430 landscape, Dynamic Island and home indicator.
- iPad Pro 11": 834×1194 portrait, 1194×834 landscape.

## Phase 1 requirements

### Shell
- Home screen with app icons (Terminal, Code, Antigravity, Settings; plus "Code + Chat" where split view is available)
  and Resume widgets built only from real local data (recent files, recent sessions). No invented health/metrics.
- Persistent floating dock: app launchers with running indicators, Home, App Switcher, Control Center, and on iPad a
  Code + Chat split toggle. It hides while the on-screen keyboard is open.
- Apps run full screen on iPhone. On iPad, Code and Antigravity can run side by side with a resizable divider
  (drag, arrow keys, or double-tap to reset).
- App switching preserves each app's state: apps stay mounted while open; only their placement changes.
- App Switcher: one card per open app with a live one-line summary; Open and Close buttons; closing an app with
  unsaved work asks first.
- Control Center: dark mode, reduce motion, Code + Chat (iPad), terminal key row, text size, accent colour,
  link to Settings, and the honest connection state ("Demo mode — not connected").
- A first-run sheet and a persistent "Demo mode" chip explain what is simulated and where data is stored.

### Terminal (simulated in Phase 1)
- xterm.js terminal driven by a clearly labelled simulated shell running in the browser.
- Line editing, history, tab completion, Ctrl+C/L/U/D, multi-line paste; commands over the demo project files.
- Touch key row: Esc, Tab, sticky Ctrl, arrows and common symbols; keys don't dismiss the keyboard.
- Copy/paste buttons, keyboard show/hide, font size, clear, restart.
- Width: "Fit" (columns follow the screen) or a fixed 80/100/120/160 columns. A wider terminal pans sideways
  (swipe left/right, thin position bar), follows the cursor as you type, and "Fit width" (or pinch, down to 5px)
  zooms out until every column is on screen.
- States: connecting, connected, reconnecting (demo trigger), disconnected (after `exit`), error.

### Code
- CodeMirror 6 editor with syntax highlighting, tabs per open file (independent undo history), file browser
  (sidebar on wide layouts, sheet on phones), new/rename/delete, dirty indicators, save (button and ⌘/Ctrl+S), revert.
- Files are saved in this browser's local storage; the UI says they do not sync between devices.
- External changes (e.g. `echo > file` in Terminal) reload clean tabs and warn on dirty ones.
- Touch toolbar: undo, redo, indent, outdent, find, save.

### Antigravity (simulated in Phase 1)
- Projects → sessions → conversation; stacked navigation on narrow widths, two columns on wide ones.
- New session, rename, delete, session info, mode (default / plan / accept-edits) and model selection.
- Composer pinned above the keyboard; send; stop while running; per-session drafts.
- Sample activity items and canned replies clearly marked as simulated.
- Controls follow an explicit capability list for the real `agy` CLI
  (`src/services/runner/agyCapabilities.ts`): supported → enabled; unsupported → disabled with an explanation;
  unverified → not offered, listed in "What's supported".

### Settings
- Appearance (theme, accent, wallpaper, text size, motion), terminal options, split view, keyboard shortcuts,
  data & storage (export / import / reset), about and "what is simulated".

### Cross-cutting
- Safe-area insets, Safari's dynamic toolbar (dynamic viewport units), and the on-screen keyboard
  (shell sized to the visual viewport).
- Touch targets ≥ 44 CSS px where practical; visible alternatives to every gesture.
- Accessible names, contrast in light and dark themes, visible focus, reduced motion.
- Hardware keyboard shortcuts (Ctrl+Shift+…) that don't collide with iPadOS/Safari ⌘ shortcuts or shells.
- Demo data separated from integration logic behind three interfaces:
  `TerminalBackend`, `FileStore`, `RunnerAdapter`.

## Phase 1 acceptance criteria (observable)

1. `npm run build` succeeds, and `npm run preview` serves the app.
2. Layouts render without clipping, unreadable text or dock overlap at iPhone portrait/landscape and iPad
   portrait/landscape (Chromium emulation; Safari checked on device separately).
3. Navigating Home → app → another app → back keeps state: terminal scrollback, editor buffer (including unsaved
   edits) and chat drafts survive.
4. Code: edit a file, save, reload the page, and the saved content is still there.
5. Antigravity: create a session, send a message, receive a simulated reply, stop a running turn, rename and delete.
6. iPad: Code + Chat split view opens, both panes work, the divider resizes; not offered on iPhone.
7. App Switcher lists open apps with summaries and closes apps (with a confirmation for unsaved work).
8. Every simulated surface is labelled; nothing claims a live Ubuntu connection.
9. Automated unit tests and Playwright interaction tests pass.

## Out of scope

Approval prompts for agy tools (print mode cannot ask; tools are skipped unless allowed), live token-by-token
agy output, multiple users, and a general installer for machines other than the Runpod pod.
