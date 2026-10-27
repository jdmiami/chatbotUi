"""The serverless AI machine's job loop (Runpod serverless handler).

One worker = one container with ComfyUI and the gate inside (start.sh), the same code as the AI
machine. Runpod hands jobs to `handler`; each one is sent to the gate on 127.0.0.1 exactly as Make
sends it to the AI machine, and the gate does the rest: NSFW check, held results, characters, the
gallery and thumbnails in R2. The answer is the gate's own job record.

    input: { "op": "make", "job": { kind, maker, prompt, ... } }   the same body as POST /_orbit/studio/jobs
           { "op": "prepare" }                                      bring every added maker's files onto the drive
           { "op": "makers" }                                       which makers are ready here
           { "op": "ping" }                                         is the machine up (and what it reports)
"""

import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

import runpod

GATE = "http://127.0.0.1:8080"
SECRET = os.environ.get("GATEWAY_SECRET", "")
START_TIMEOUT = int(os.environ.get("START_TIMEOUT_SECONDS", "900"))
# A maker's files come down from R2 the first time (tens of GB): wait this long for them at most.
DOWNLOAD_TIMEOUT = int(os.environ.get("DOWNLOAD_TIMEOUT_SECONDS", "5400"))
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT_SECONDS", "3600"))

_gate = None


def log(*a):
    print("[handler]", *a, flush=True)


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token() -> str:
    """A fresh HS256 token the gate accepts (jwt.js: audience orbit-ai, at most 65 minutes old)."""
    now = int(time.time())
    head = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64url(json.dumps({"iat": now, "exp": now + 3600, "aud": "orbit-ai", "sub": "serverless"}, separators=(",", ":")).encode())
    sig = hmac.new(SECRET.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{b64url(sig)}"


class GateError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def call(path, method="GET", body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(GATE + path, data=data, method=method)
    req.add_header("authorization", "Bearer " + token())
    if data is not None:
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read() or b"{}").get("error")
        except Exception:
            msg = None
        if isinstance(msg, dict):
            msg = msg.get("message")
        raise GateError(msg or f"The maker answered {e.code}.", e.code) from None


def healthy() -> bool:
    try:
        with urllib.request.urlopen(GATE + "/healthz", timeout=5) as res:
            return res.status == 200
    except Exception:
        return False


def start_gate():
    """ComfyUI and the gate, once per worker (start.sh keeps them running)."""
    global _gate
    if _gate is not None and _gate.poll() is None:
        return
    log("starting ComfyUI and the gate")
    _gate = subprocess.Popen(["/bin/bash", "/opt/serverless/start.sh"], stdout=sys.stdout, stderr=sys.stderr)


def studio_state():
    return call("/_orbit/studio")


def wait_ready(job, deadline):
    """Until the gate answers and ComfyUI is running (the first start of a worker takes a minute or two)."""
    start_gate()
    said = None
    while time.time() < deadline:
        if _gate is not None and _gate.poll() is not None:
            raise GateError("The maker stopped unexpectedly while starting.")
        if healthy():
            try:
                st = studio_state()
            except GateError:
                st = None
            if st and st.get("running") and st.get("setup") == "running":
                return st
            word = (st or {}).get("setup") or "starting"
            if word != said:
                said = word
                runpod.serverless.progress_update(job, {"status": "starting", "detail": f"Starting the maker ({word})"})
        time.sleep(2)
    raise GateError("The maker did not start in time.", 504)


def makers():
    return call("/_orbit/studio/makers").get("makers", [])


def wait_maker(job, maker_id, deadline):
    """Until the job's maker is installed here (its files come down from R2 onto the drive the first time)."""
    last = None
    while time.time() < deadline:
        m = next((x for x in makers() if x.get("id") == maker_id), None)
        if m is None:
            raise GateError(f"There is no maker called {maker_id}.", 404)
        if m.get("installed"):
            return m
        if not m.get("wanted") and not m.get("builtIn"):
            raise GateError(f"{m.get('name', maker_id)} is not added. Add it in Makers (with the AI machine on) first.", 409)
        st = studio_state()
        cur = st.get("downloading") or {}
        line = f"Getting {m.get('name', maker_id)}'s files onto the drive: {m.get('percent', 0)}%"
        if cur.get("name"):
            line += f" ({cur['name']} {cur.get('percent', 0)}%)"
        if line != last:
            last = line
            runpod.serverless.progress_update(job, {"status": "downloading", "percent": m.get("percent", 0), "detail": line})
        time.sleep(5)
    raise GateError("The maker's files did not finish downloading in time. Try again; it carries on where it was.", 504)


def make(job, req):
    deadline = time.time() + START_TIMEOUT
    wait_ready(job, deadline)
    maker = req.get("maker")
    if isinstance(maker, str) and maker:
        wait_maker(job, maker, time.time() + DOWNLOAD_TIMEOUT)
    j = call("/_orbit/studio/jobs", "POST", req, timeout=120)
    jid = j.get("id")
    if not jid:
        raise GateError(j.get("error") or "The maker did not take the job.")
    end = time.time() + JOB_TIMEOUT
    last = None
    while time.time() < end:
        j = call(f"/_orbit/studio/jobs/{jid}")
        status = j.get("status")
        if status in ("done", "error", "stopped"):
            break
        snap = (status, j.get("progress"), j.get("etaSeconds"), len(j.get("notes") or []))
        if snap != last:
            last = snap
            runpod.serverless.progress_update(
                job,
                {"status": status, "progress": j.get("progress"), "etaSeconds": j.get("etaSeconds"), "slow": j.get("slow"), "notes": j.get("notes") or []},
            )
        time.sleep(2)
    else:
        call(f"/_orbit/studio/jobs/{jid}/cancel", "POST", {})
        raise GateError("That took too long and was stopped.", 504)
    # The gate strips nothing the site needs; the item is already in R2 (gallery, thumbnail, note).
    return j


def handler(job):
    inp = job.get("input") or {}
    op = inp.get("op") or ("make" if "job" in inp else "ping")
    try:
        if op == "ping":
            start_gate()
            return {"ok": healthy(), "studio": studio_state() if healthy() else None}
        if op == "makers":
            wait_ready(job, time.time() + START_TIMEOUT)
            return {"makers": makers()}
        if op == "prepare":
            wait_ready(job, time.time() + START_TIMEOUT)
            deadline = time.time() + DOWNLOAD_TIMEOUT
            for m in makers():
                if (m.get("wanted") or m.get("builtIn")) and not m.get("installed"):
                    wait_maker(job, m["id"], deadline)
            return {"makers": makers()}
        if op == "make":
            req = inp.get("job")
            if not isinstance(req, dict):
                raise GateError("Send the job to make: { op: 'make', job: { kind, maker, prompt, ... } }.", 400)
            j = make(job, req)
            if j.get("status") != "done":
                # Runpod marks the job failed (and never retries it); the gate's words say why.
                return {"error": j.get("error") or "That did not finish.", "job": j}
            return {"job": j}
        raise GateError(f"Unknown op {op!r}.", 400)
    except GateError as e:
        return {"error": str(e), "status": e.status}


if __name__ == "__main__":
    if len(SECRET) < 32:
        log("GATEWAY_SECRET (32+ characters) is required")
        sys.exit(1)
    start_gate()
    runpod.serverless.start({"handler": handler})
