"""Télécharge les paires Flagship utiles depuis Hugging Face (environ 81 Mo par paire).
    pip install ctranslate2 sentencepiece huggingface_hub
    python3 services/fetch_flagship.py [ewondo fufulde bulu ghomala yemba ...]
"""
import os, sys
from huggingface_hub import snapshot_download
langs = sys.argv[1:] or ["ewondo", "fufulde", "bulu", "ghomala", "yemba"]
pairs = [f"{l}-francais" for l in langs] + [f"francais-{l}" for l in langs]
dest = os.path.join(os.path.dirname(__file__), "..", "models", "flagship-cameroon-int8")
snapshot_download("flagship-ai/cameroon-int8", revision="178a2757c161f4341ab8ef1d283d19b695963a2d", allow_patterns=[f"{p}/*" for p in pairs], local_dir=dest)
print("ok :", ", ".join(pairs))
