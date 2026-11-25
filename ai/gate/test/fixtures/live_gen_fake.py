"""The live worker (live_gen_worker.py) with a stand-in engine, for tests: no model, no graphics card.
Each step sends two 8 x 8 frames whose grey level counts up, and says which words it followed."""
import os
import sys
import time

os.environ["LIVE_ENGINE"] = "fake"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
import numpy as np  # noqa: E402
import live_gen_worker as w  # noqa: E402

w.DEVICE = "cpu"


def fake_engine():
    def run(session):
        n = 0
        while not session.stopped:
            w.drain()
            if session.new_prompt:
                session.prompt, session.new_prompt = session.new_prompt, None
            if session.prompt == "explode":
                raise ValueError("it broke")
            frames = [np.full((8, 8, 3), (n + i) % 256, dtype=np.uint8) for i in range(2)]
            w.say({"event": "frames", "frames": [w.jpeg(f) for f in frames], "fps": 8, "words": session.prompt, "keys": sorted(session.keys)})
            n += 2
            time.sleep(0.02)

    return run


w.ENGINES["fake"] = fake_engine
w.ENGINE = "fake"
w.main()
