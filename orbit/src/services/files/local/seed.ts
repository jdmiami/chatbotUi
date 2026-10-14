/** Demo project shown on first run. Pure sample content — nothing here exists on a server. */

export const DEMO_PROJECT_NAME = 'orbit-demo';

export const DEMO_PROJECT_FILES: { path: string; content: string }[] = [
  {
    path: 'README.md',
    content: `# orbit-demo

This is a **sample project stored in your browser** so you can try the Orbit editor.
Edits are saved to this browser's local storage. They do not reach any Ubuntu machine
and do not sync to your other devices.

- \`src/app.py\` — a tiny Flask-style app
- \`src/utils.ts\` — TypeScript helpers
- \`config/settings.json\` — sample configuration
`,
  },
  {
    path: 'src/app.py',
    content: `"""Sample service used by the Orbit demo project."""

from dataclasses import dataclass


@dataclass
class Greeting:
    name: str

    def render(self) -> str:
        return f"Hello, {self.name}!"


def main() -> None:
    print(Greeting("Orbit").render())


if __name__ == "__main__":
    main()
`,
  },
  {
    path: 'src/utils.ts',
    content: `export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
`,
  },
  {
    path: 'config/settings.json',
    content: `{
  "name": "orbit-demo",
  "port": 8000,
  "features": {
    "greeting": true,
    "telemetry": false
  }
}
`,
  },
  {
    path: 'notes/todo.md',
    content: `# TODO

- [ ] Connect Orbit to the real Ubuntu host (Phase 2)
- [ ] Replace the simulated terminal with a PTY
- [ ] Drive the real Antigravity CLI
`,
  },
];
