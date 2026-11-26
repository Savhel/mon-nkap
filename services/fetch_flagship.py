"""Télécharge les paires Flagship utiles depuis Hugging Face.

Par défaut : le pack int8 prêt à l'emploi (environ 81 Mo par paire, licence CC BY-NC 4.0).
    pip install ctranslate2 sentencepiece huggingface_hub
    python3 services/fetch_flagship.py [ewondo fufulde bulu ghomala yemba ...]

Avec --ccby : les poids d'origine publiés sous CC BY 4.0 (environ 300 Mo par paire), convertis ici en int8.
Le résultat est identique octet pour octet au pack int8 (vérifié sur fufulde-francais et francais-fufulde), avec une licence
qui autorise tout usage avec attribution. Le tokenizer est celui de Helsinki-NLP/opus-mt-en-fr (Apache-2.0),
identique à celui du pack. Seuls fufulde, ghomala et bulu existent sous cette forme (pas l'ewondo ni le yemba).
    pip install ctranslate2 sentencepiece huggingface_hub transformers torch
    python3 services/fetch_flagship.py --ccby [fufulde ghomala bulu]
"""
import os, shutil, subprocess, sys, tempfile
from huggingface_hub import hf_hub_download, snapshot_download

dest = os.path.join(os.path.dirname(__file__), "..", "models", "flagship-cameroon-int8")
args = [a for a in sys.argv[1:] if a != "--ccby"]

if "--ccby" not in sys.argv:
    langs = args or ["ewondo", "fufulde", "bulu", "ghomala", "yemba"]
    pairs = [f"{l}-francais" for l in langs] + [f"francais-{l}" for l in langs]
    snapshot_download("flagship-ai/cameroon-int8", revision="178a2757c161f4341ab8ef1d283d19b695963a2d", allow_patterns=[f"{p}/*" for p in pairs], local_dir=dest)
    print("ok :", ", ".join(pairs))
    sys.exit(0)

CCBY = {  # révisions figées des dépôts CC BY 4.0
    "fufulde-francais": "d2737552397abadbc261e425d852c053c8b817e6", "francais-fufulde": "e2c03370493945d7ff38d2b130522b6955a5838b",
    "ghomala-francais": "c28963a8f09a5d8be1d03e42bdb0d77585238702", "francais-ghomala": "28869ed171456ebfc5bd06a04808e324d26552d1",
    "bulu-francais": "4b61fc5e3e2524c26c9089e8572fb438b8c96d04", "francais-bulu": "4a9bcca5b087dcd29e6438533f00579fde5c2b19",
}
HELSINKI = ("Helsinki-NLP/opus-mt-en-fr", "dd7f6540a7a48a7f4db59e5c0b9c42c8eea67f18")
langs = args or ["fufulde", "ghomala", "bulu"]
pairs = [p for l in langs for p in (f"{l}-francais", f"francais-{l}")]
missing = [p for p in pairs if p not in CCBY]
if missing:
    sys.exit(f"pas de version CC BY pour : {', '.join(missing)} (utiliser le pack par défaut)")

tok = {f: hf_hub_download(HELSINKI[0], f, revision=HELSINKI[1]) for f in ("source.spm", "target.spm", "vocab.json", "tokenizer_config.json")}
converter = shutil.which("ct2-transformers-converter", path=os.path.dirname(sys.executable)) or "ct2-transformers-converter"
for p in pairs:
    with tempfile.TemporaryDirectory() as tmp:
        snapshot_download(f"flagship-ai/{p}", revision=CCBY[p], local_dir=tmp)
        # Le tokenizer est partagé : pour français → langue, source et cible sont inversées.
        src, tgt = ("source.spm", "target.spm") if p.endswith("-francais") else ("target.spm", "source.spm")
        shutil.copy(tok[src], os.path.join(tmp, "source.spm"))
        shutil.copy(tok[tgt], os.path.join(tmp, "target.spm"))
        shutil.copy(tok["vocab.json"], tmp)
        shutil.copy(tok["tokenizer_config.json"], tmp)
        subprocess.run([converter, "--model", tmp, "--output_dir", os.path.join(dest, p), "--quantization", "int8",
                        "--copy_files", "source.spm", "target.spm", "--force"], check=True)
    print("converti :", p)
