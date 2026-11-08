"""Orbit: a start-up check for Comfy Kitchen's fast INT8 attention (installed by studio.sh as a ComfyUI
custom node, so it runs when ComfyUI starts, before any model loads).

Some model files (MiniMax H3's int8 files from Comfy-Org) ask ComfyUI for Comfy Kitchen's INT8 attention.
comfy-kitchen's kernels are built with CUDA 13, which needs NVIDIA driver 580 or newer; its own check only
looks at the GPU, not the driver. On a machine with an older driver (some GPU.ai H100s) every such video then
fails with "detect_k_anchor kernel launch failed: CUDA driver version is insufficient for CUDA runtime version".

So the kernel is tried once here on a tiny input. If it can't run, it is switched off and ComfyUI uses its
standard attention for those models instead (slower, but it works).
"""

import logging

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def _check():
    try:
        import torch
        import comfy_kitchen
        from comfy_kitchen.backends import cuda as ck_cuda
    except Exception:
        return
    if not torch.cuda.is_available() or not getattr(ck_cuda, "_EXT_AVAILABLE", False):
        return
    try:
        if not comfy_kitchen.int8_attention_is_available(torch.device("cuda")):
            return
        q = torch.randn(1, 2, 128, 128, device="cuda", dtype=torch.bfloat16)
        comfy_kitchen.int8_attention(q, q, q)
        torch.cuda.synchronize()
        logging.info("[orbit] Comfy Kitchen INT8 attention works on this machine.")
    except Exception as err:  # the driver is too old for its CUDA 13 kernels, or the kernel can't run here
        # comfy_kitchen.int8_attention_is_available() reads this flag on every call, so models that ask
        # for it now get ComfyUI's standard attention.
        ck_cuda._EXT_AVAILABLE = False
        logging.warning("[orbit] Comfy Kitchen INT8 attention can't run here (%s); using standard attention instead.", str(err).splitlines()[0][:200])


_check()
