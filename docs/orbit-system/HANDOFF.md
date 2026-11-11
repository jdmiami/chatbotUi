# OrbitSystem: handoff for a new chat

Start here. `orbit-system` is a long-lived branch for **OrbitSystem**: Orbit rebuilt as an operating system driven by sensors. Today's Orbit on `main` keeps going as it is, and nothing from this branch reaches `main` or the live site without the owner's explicit go.

- Base: `main` at `55d4c33` (NSFW blur, PR #69).
- Work happens on `orbit-system`. Open PRs into `orbit-system`, never into `main`.
- To bring Orbit's fixes in: merge `main` into `orbit-system` (a merge commit, never a rebase).
- Vercel builds a preview for every push to this branch. It shares the project, settings and secrets with today's Orbit, so never change shared environment variables for OrbitSystem: give anything new an `ORBITSYSTEM_` name.
- Orbit Space (`claude/orbit-space`, draft PR #59) is a separate fork: the 3D world of paper pages. OrbitSystem may borrow from it, but neither depends on the other.

## 1. The idea

Orbit stops waiting for taps. It reads what the phone or iPad senses (how it's held and moved, what it hears, sees and where it is) and what the machines sense (GPU and CPU heat, power, load, network). The orb and the screens react to that on their own. Every sensor is opt-in, visible while in use, and can be paused from one place.

## 2. Sensors chosen by the owner

### A. Phone and iPad

| Sensor | Web API | Already in Orbit | Notes |
|---|---|---|---|
| Tilt and orientation | `DeviceOrientationEvent` | `orbit/src/motion/tilt.ts` (writes `--tx`/`--ty`; asks permission on iPhone) | Start here: generalise it into the sensor hub. |
| Motion: shake, flick, step rhythm | `DeviceMotionEvent` | — | Same permission as tilt on iOS. |
| Microphone | `getUserMedia({ audio })` | `orbit/src/shell/orb/listen.ts`, `apps/ai/VoiceMode.tsx` | Level, voice, clap or whistle triggers. |
| Camera | `getUserMedia({ video })` | — | Hand or face presence, light level from frames. Processing stays on the device. |
| Location | `navigator.geolocation` | — | Context such as home or away; coarse by default. |
| Ambient light | `AmbientLightSensor` (not on iOS) | — | Fall back to the camera's average brightness. |
| Touch pressure and size | `PointerEvent.pressure`, `width/height` | Orb and censor hold-to-see use pointer events | iPad with Pencil reports real pressure. |
| Battery and power | `navigator.getBattery()` (not on iOS) | — | Low Power Mode is guessed today by the motion probe. |
| Screen and keyboard | `visualViewport`, Screen Orientation | `orbit/src/state/viewport.ts` | Already tracks keyboard and size. |
| Haptics out | `navigator.vibrate` (Android) | `orbit/src/motion/feedback.ts` | iPhone Safari has no vibrate. |

iPhone and iPad rules that shape the design:
- Motion and orientation need a permission asked from a tap.
- The camera and microphone need a tap, HTTPS and a visible indicator, and they stop when the tab is hidden.
- There's no ambient light, battery or vibrate API in Safari.
- Anything that has to run in the background needs a native wrapper (see 5).

### B. The machines' own sensors

| Sensor | Where it is read today | Notes |
|---|---|---|
| GPU name, load, memory, temperature, power draw | `ai/gate/src/gpustats.js` (`nvidia-smi`) | AI machine. |
| CPU, memory, disk, network, per-process use | `ai/gate/src/sysstats.js`, `gateway/src/sysstats.js` (cgroup v2 and `/proc`) | AI machine and Linux machine. |
| Served at | `GET /_orbit/stats` on the AI gate; the gateway's stats on the Linux machine | Glass Island and Settings → Usage already poll them. |
| Busy, idle, auto-off timers | `gateway/src/idle.js`, `ai/gate/src/machine.js` | The hour countdown. |

Next step for the machines: stream instead of poll (a WebSocket or Server-Sent Events channel `/_orbit/sensors`, about 1 reading a second), and keep a short history (an hour, ring buffer) so screens can draw trends.

## 3. Proposed architecture

1. **Sensor hub (phone).** `orbit/src/sensors/hub.ts` holds one store of readings, each with its source, value, unit, time, and whether it's on. Each sensor is its own small module with `start()`, `stop()`, `permission()` and `available()`. Tilt moves in first, unchanged in behaviour.
2. **Machine sensors.** One stream from each machine with the same reading shape, merged into the hub, so a screen doesn't care where a reading came from.
3. **Rules.** Small, readable "when → then" rules on top of the hub. For example:
   - "when the GPU is over 85 °C for a minute → the orb turns amber and says so";
   - "when the phone lies face down → pause everything and blur";
   - "when it's shaken → undo".
   Rules live in settings and are listed, not hidden.
4. **Privacy panel.** One screen lists every sensor: on or off, the last reading, and what uses it. One switch pauses them all. Nothing leaves the device unless a rule says so and the panel shows it.
5. **Later: native shell.** A Capacitor (or similar) wrapper for background sensors, real haptics on iPhone and widgets. The web app stays the core.

## 4. First steps on this branch

1. Sensor hub, with tilt moved into it and a test that tilt behaves exactly as before.
2. The privacy panel (Settings → Sensors), with every phone sensor's availability and permission state.
3. The machine stream: `/_orbit/sensors` on the AI gate and the Linux gateway, reusing `gpustats` and `sysstats`.
4. One live screen: the orb reacts to GPU heat and load, and to phone motion.
5. Rules v1: three built-in rules, each with an on/off switch.

## 5. Rules carried over from Orbit

- Plain language in the UI, made for iPhone and iPad first, with 44 px tap targets, no sideways scrolling and Playwright on 4 viewports.
- Every change ships as a PR, here into `orbit-system`.
- Secrets live in Vercel and Runpod. Never print or ask for them.
- Starting the machines is allowed (the owner is told when they're on). Anything else billable, public or destructive is asked first.
- Studio content rules: no sexual content with minors, ever, and uploaded photos can't be sexualised or undressed. The NSFW blur from `main` applies here too.
