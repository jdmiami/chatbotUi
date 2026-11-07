"""
Turn CMU motion-capture recordings into Flipbook's Action Pack.

The CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu) is free for research and commercial
projects ("Use this data!"). Each recording is a 3D skeleton (.asf) and its motion (.amc, 120 frames
a second). This script replays the skeleton, looks at it from the side (or the front, for cartwheels),
trims the still parts at either end, keeps 12 frames a second, and writes the joints a stick figure
needs, already in note units (0..1 across the paper, feet on the ground line), to
src/apps/flipbook/moves/actionPack.json. Flipbook fits its own skeleton to those joints at any level.

Usage (from orbit/):
    python3 -I scripts/mocap/cmu_to_flipbook.py <folder with the downloaded .asf and .amc files>
Download a clip with:
    curl -O http://mocap.cs.cmu.edu/subjects/88/88.asf -O http://mocap.cs.cmu.edu/subjects/88/88_01.amc
"""
import json
import math
import os
import sys

import numpy as np

# id, name, group, CMU trial, view, (optional) seconds to keep from..to
CLIPS = [
    ("backflip", "Backflip", "Flips", "88_01", "side", None),
    ("backflip-2", "Standing backflip", "Flips", "87_03", "side", None),
    ("monkey-flip", "Monkey backflip", "Flips", "90_19", "side", None),
    ("front-handspring", "Front handspring", "Flips", "90_14", "side", None),
    ("hand-flip", "Flip onto hands and back", "Flips", "90_09", "side", None),
    ("side-flip", "Side flip", "Flips", "90_08", "front", None),
    ("cartwheel-backflip", "Cartwheel into backflip", "Flips", "88_05", "front", None),
    ("cartwheel", "Cartwheel", "Cartwheels", "49_06", "front", None),
    ("cartwheel-2", "Big cartwheel", "Cartwheels", "90_02", "front", None),
    ("jump-kick", "Jump kick", "Kicks", "90_05", "side", None),
    ("spin-kick", "Jumping spin kick", "Kicks", "88_06", "side", None),
    ("kick-spin", "Jump, kick and spin", "Kicks", "87_01", "side", None),
    ("kick-flip", "Kick flip", "Kicks", "85_06", "side", None),
    ("handstand-kicks", "Handstand kicks", "Kicks", "85_05", "side", None),
    ("flying-kick", "Flying jump kick", "Kicks", "75_16", "side", None),
    ("front-kick", "Front kick", "Kicks", "144_05", "side", (0, 4)),
    ("punches", "Punch combo", "Punches", "144_20", "side", (0, 5)),
    ("boxing", "Boxing", "Punches", "14_01", "side", (0, 5)),
    ("dive-roll", "Run, dive and roll", "Falls and rolls", "127_23", "side", None),
    ("fall-face", "Fall flat on the face", "Falls and rolls", "90_16", "side", None),
    ("flip-fall", "Back flip, twist and fall", "Falls and rolls", "90_12", "side", None),
    ("rug-pull", "Rug pulled away", "Falls and rolls", "90_18", "side", None),
    ("jump-360", "360 jump", "Jumps", "75_08", "front", None),
    ("jump-twist", "Jump twist", "Jumps", "85_01", "front", None),
    ("long-jump", "Long jump", "Jumps", "16_05", "side", None),
    ("high-jump", "High jump", "Jumps", "16_03", "side", None),
    ("run", "Run", "Run and walk", "09_01", "side", None),
    ("walk", "Walk", "Run and walk", "08_01", "side", None),
]

# The joints Flipbook needs, and which CMU bone ends at each (None = the root, the pelvis).
JOINTS = {
    "pelvis": None,
    "spine1": "lowerback",
    "spine2": "upperback",
    "neckBase": "thorax",
    "neckTop": "upperneck",
    "headTop": "head",
    "shoulderL": "lclavicle",
    "elbowL": "lhumerus",
    "wristL": "lradius",
    "handL": "lhand",
    "shoulderR": "rclavicle",
    "elbowR": "rhumerus",
    "wristR": "rradius",
    "handR": "rhand",
    "hipL": "lhipjoint",
    "kneeL": "lfemur",
    "ankleL": "ltibia",
    "footL": "lfoot",
    "toeL": "ltoes",
    "hipR": "rhipjoint",
    "kneeR": "rfemur",
    "ankleR": "rtibia",
    "footR": "rfoot",
    "toeR": "rtoes",
}

FPS_IN = 120
FPS_OUT = 12
GROUND = 0.885  # Flipbook's standing figure has its feet here
LEG = (0.13 + 0.13) * 1.25  # its thigh + shin
MAX_SECONDS = 6


def euler(rx, ry, rz):
    """Rotation about x, then y, then z (fixed axes), degrees."""
    a, b, c = (math.radians(v) for v in (rx, ry, rz))
    X = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    Y = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    Z = np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])
    return Z @ Y @ X


def read_asf(path):
    bones = {}
    children = {}
    lines = open(path, encoding="latin-1").read().split("\n")
    i = 0
    section = None
    cur = None
    while i < len(lines):
        t = lines[i].strip().split()
        i += 1
        if not t or t[0].startswith("#"):
            continue
        if t[0].startswith(":"):
            section = t[0][1:]
            continue
        if section == "bonedata":
            if t[0] == "begin":
                cur = {"dof": [], "axis": [0, 0, 0], "direction": [0, 0, 0], "length": 0}
            elif t[0] == "end":
                bones[cur["name"]] = cur
            elif t[0] == "name":
                cur["name"] = t[1]
            elif t[0] == "direction":
                cur["direction"] = [float(v) for v in t[1:4]]
            elif t[0] == "length":
                cur["length"] = float(t[1])
            elif t[0] == "axis":
                cur["axis"] = [float(v) for v in t[1:4]]
            elif t[0] == "dof":
                cur["dof"] = t[1:]
        elif section == "hierarchy":
            if t[0] in ("begin", "end"):
                continue
            children[t[0]] = t[1:]
    for b in bones.values():
        b["C"] = euler(*b["axis"])
        b["Cinv"] = np.linalg.inv(b["C"])
    return bones, children


def read_amc(path):
    frames = []
    cur = None
    for line in open(path, encoding="latin-1"):
        t = line.split()
        if not t or t[0].startswith("#") or t[0].startswith(":"):
            continue
        if len(t) == 1 and t[0].isdigit():
            cur = {}
            frames.append(cur)
            continue
        if cur is not None:
            cur[t[0]] = [float(v) for v in t[1:]]
    return frames


def pose(bones, children, frame):
    """Where every bone ends (and the root), in the recording's own units (y up)."""
    out = {}
    root = frame["root"]
    out[None] = np.array(root[:3])
    mats = {None: euler(*root[3:6])}

    def walk(parent_name, parent_key):
        for name in children.get(parent_name, []):
            b = bones[name]
            rot = [0.0, 0.0, 0.0]
            vals = frame.get(name, [])
            for k, d in enumerate(b["dof"]):
                if k < len(vals):
                    rot["xyz".index(d[1])] = vals[k]
            m = mats[parent_key] @ b["C"] @ euler(*rot) @ b["Cinv"]
            mats[name] = m
            out[name] = out[parent_key] + b["length"] * (m @ np.array(b["direction"]))
            walk(name, name)

    walk("root", None)
    return out


def convert(folder, clip):
    cid, name, group, trial, view, keep = clip
    subj = trial.split("_")[0]
    asf = os.path.join(folder, f"{int(subj):02d}.asf")
    if not os.path.exists(asf):
        asf = os.path.join(folder, f"{subj}.asf")
    amc = os.path.join(folder, f"{trial}.amc")
    bones, children = read_asf(asf)
    raw = read_amc(amc)
    if keep:
        raw = raw[int(keep[0] * FPS_IN) : int(keep[1] * FPS_IN)]
    poses = [pose(bones, children, f) for f in raw]

    # Which way the figure faces at the start: across the hips is "right"; forward is up × right.
    p0 = poses[0]
    right = p0["rhipjoint"] - p0["lhipjoint"]
    right[1] = 0
    right /= np.linalg.norm(right) or 1
    up = np.array([0.0, 1.0, 0.0])
    fwd = np.cross(right, up)
    fwd /= np.linalg.norm(fwd) or 1

    def flat(p):
        # Side view: forward runs to the right of the note. Front view: the figure faces you, so its
        # right hand is on the left of the note.
        x = float(p @ fwd) if view == "side" else -float(p @ right)
        return x, float(p[1])

    # Trim the still start and end (keeping a little), then keep 12 frames a second.
    def energy(a, b):
        return sum(np.linalg.norm(a[k] - b[k]) for k in ("lhand", "rhand", "lfoot", "rfoot", "head", None))

    step = FPS_IN // FPS_OUT
    moving = [energy(poses[k], poses[min(len(poses) - 1, k + step)]) for k in range(0, len(poses), step)]
    peak = max(moving) or 1
    active = [k for k, e in enumerate(moving) if e > peak * 0.04]
    lo = max(0, active[0] - 3) if active else 0
    hi = min(len(moving), (active[-1] + 4) if active else len(moving))
    hi = min(hi, lo + MAX_SECONDS * FPS_OUT)
    picked = [poses[k * step] for k in range(lo, hi)]

    # Note units: the leg length sets the scale; the lowest foot of the first frame stands on the ground.
    leg = np.linalg.norm(p0["lfemur"] - p0["lhipjoint"]) + np.linalg.norm(p0["ltibia"] - p0["lfemur"])
    scale = LEG / leg
    first = picked[0]
    ground = min(first[k][1] for k in ("lfoot", "rfoot", "ltoes", "rtoes", "ltibia", "rtibia"))
    x0 = flat(first[None])[0]
    # Front view: the figure faces you, so its right side is Flipbook's left (and the other way round).
    def source(jname):
        if view == "front" and jname[-1] in "LR" and jname != "pelvis":
            return JOINTS[jname[:-1] + ("R" if jname.endswith("L") else "L")]
        return JOINTS[jname]

    frames = []
    for p in picked:
        flat_frame = []
        for jname in JOINTS:
            x, y = flat(p[source(jname)])
            flat_frame += [round(0.5 + (x - x0) * scale, 3), round(GROUND - (y - ground) * scale, 3)]
        frames.append(flat_frame)
    # Each frame is x, y for every joint, in the order of "joints".
    return {"id": cid, "name": name, "group": group, "source": f"CMU {trial}", "view": view, "fps": FPS_OUT, "frames": frames}


def main():
    folder = sys.argv[1]
    moves = []
    for clip in CLIPS:
        try:
            moves.append(convert(folder, clip))
            print(f"{clip[0]:20s} {len(moves[-1]['frames']):3d} frames")
        except FileNotFoundError as e:
            print(f"{clip[0]:20s} missing: {e.filename}")
    out = {
        "about": "Flipbook's Action Pack: recorded human motion from the CMU Graphics Lab Motion Capture Database "
        "(mocap.cs.cmu.edu), free for research and commercial projects. The database was created with funding "
        "from NSF EIA-0196217. Joints are in note units (0..1), 12 frames a second.",
        "joints": list(JOINTS),
        "moves": moves,
    }
    dest = os.path.join(os.path.dirname(__file__), "..", "..", "src", "apps", "flipbook", "moves", "actionPack.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", os.path.normpath(dest), os.path.getsize(dest), "bytes")


if __name__ == "__main__":
    main()
