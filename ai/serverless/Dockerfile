# The serverless AI machine: the same image and video maker as the AI machine (ai/setup.sh +
# ai/studio.sh), packed into one container that Runpod starts per job and stops when it is done.
# Models live on a Runpod network volume (/runpod-volume), synced from Cloudflare R2 the first time;
# the gallery, characters and held results go to R2 as on the AI machine (STORAGE=r2).
#
# Built by .github/workflows/worker.yml into ghcr.io/jdmiami/orbit-ai-worker:<commit>.
# Runs: ai/serverless/handler.py (the Runpod job loop) -> ai/serverless/start.sh (ComfyUI + the gate).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      ca-certificates curl git python3 python3-venv python3-pip ffmpeg xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js for the gate (the same version ai/setup.sh installs on the AI machine).
ARG NODE_VERSION=22.20.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" | tar -xJ -C /opt \
    && ln -s "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node

# The repository laid out as on the AI machine (ai/gate next to shared/), so the gate's imports work.
WORKDIR /opt/orbit
COPY shared/ shared/
COPY ai/ ai/
RUN ln -sfn /opt/orbit/ai/gate /opt/gate && cp ai/studio.sh ai/live_env.sh ai/gate/

# ComfyUI, PyTorch and the custom nodes, installed once into the image by the same script the AI
# machine uses (its pins are the one source of truth). Models are not here: they come from the volume.
ENV STUDIO_DIR=/opt/studio
RUN STUDIO_INSTALL_ONLY=1 ENV_BAKED=1 PERSIST_DIR=/opt STORAGE=volume AI_ROLE=main NODE=/opt/node/bin/node \
      bash /opt/gate/studio.sh \
    && /opt/studio/venv/bin/python -m pip install -q "runpod>=1.7,<2" \
    && rm -rf /opt/studio/pip-cache

COPY ai/serverless/start.sh ai/serverless/handler.py /opt/serverless/
RUN chmod +x /opt/serverless/start.sh

# Runpod serverless workers run the handler; it starts ComfyUI and the gate itself.
CMD ["/opt/studio/venv/bin/python", "-u", "/opt/serverless/handler.py"]
