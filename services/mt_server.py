"""Service local de traduction Flagship (CTranslate2), appelé par le moteur Node.

    python3 services/mt_server.py [--port 8091] [--models models/flagship-cameroon-int8]

POST /translate {"pair": "francais-ewondo", "texts": ["..."]} -> {"translations": ["..."], "ms": 12}
GET  /pairs -> paires disponibles localement

Moteurs (tous en CTranslate2 int8, hors ligne) :
- Flagship (paires « francais-ewondo »…) : https://huggingface.co/flagship-ai/cameroon-int8
- OPUS-MT tc-bible-big (Apache-2.0), paires « opus:francais-duala », « opus:duala-francais »… :
  fra→langues bantoues (models/opus/fra-bnt) et langues → fra (models/opus/mul-fra). La langue visée est donnée
  par un jeton (>>dua<<) ; une paire n'est proposée que si ce jeton existe dans le vocabulaire du modèle.
Modèles Flagship : https://huggingface.co/flagship-ai/cameroon-int8 (licence à clarifier : CC BY-NC 4.0
sur la fiche du dépôt, CC-BY-4.0 dans les README par paire). Démo uniquement tant que ce n'est pas clarifié.
Téléchargement : python3 services/fetch_flagship.py
"""
import argparse, json, os, re, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ctranslate2, sentencepiece as spm

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8091)
ap.add_argument("--models", default=os.path.join(os.path.dirname(__file__), "..", "models", "flagship-cameroon-int8"))
ap.add_argument("--opus", default=os.path.join(os.path.dirname(__file__), "..", "models", "opus"))
args = ap.parse_args()
PAIR_RE = re.compile(r"^(opus:)?[a-z]+-[a-z]+$")
# Langues visées par OPUS : nom utilisé dans les paires → code ISO du jeton.
OPUS_LANGS = {"duala": "dua", "ewondo": "ewo", "bulu": "bum", "eton": "eto", "basaa": "bas", "koonzime": "ozm", "bakaka": "bqz",
              "fulfulde": "fuv", "pidgin": "pcm", "ngiemboon": "nnh", "meta": "mgo"}
_cache = {}

def opus_pairs():
    """Paires OPUS réellement disponibles : modèle présent ET jeton de langue connu du vocabulaire."""
    out = {}
    for model, direction in (("fra-bnt", "from"), ("mul-fra", "to")):
        d = os.path.join(args.opus, model)
        if not os.path.isfile(os.path.join(d, "model.bin")):
            continue
        vocab_files = [os.path.join(d, f) for f in ("shared_vocabulary.json", "source_vocabulary.json", "shared_vocabulary.txt", "source_vocabulary.txt") if os.path.isfile(os.path.join(d, f))]
        text = open(vocab_files[0], encoding="utf8").read() if vocab_files else ""
        for name, code in OPUS_LANGS.items():
            if direction == "from" and f">>{code}<<" in text:
                out[f"opus:francais-{name}"] = (d, f">>{code}<<")
            if direction == "to" and ">>fra<<" in text:
                out[f"opus:{name}-francais"] = (d, ">>fra<<")
    return out

def load(pair):
    if pair not in _cache and pair.startswith("opus:"):
        d, token = opus_pairs()[pair]
        key = d
        if key not in _cache:
            _cache[key] = (ctranslate2.Translator(d, device="cpu", compute_type="int8", inter_threads=1, intra_threads=2),
                           spm.SentencePieceProcessor(model_file=os.path.join(d, "source.spm")),
                           spm.SentencePieceProcessor(model_file=os.path.join(d, "target.spm")))
        t, s, g = _cache[key]
        _cache[pair] = (t, s, g, token)
    if pair not in _cache:
        d = os.path.join(args.models, pair)
        _cache[pair] = (ctranslate2.Translator(d, device="cpu", compute_type="int8", inter_threads=1, intra_threads=2),
                        spm.SentencePieceProcessor(model_file=os.path.join(d, "source.spm")),
                        spm.SentencePieceProcessor(model_file=os.path.join(d, "target.spm")))
    return _cache[pair]

def translate(pair, texts):
    t, s, g, *rest = load(pair)
    prefix = [rest[0]] if rest else []
    toks = [prefix + s.encode(x, out_type=str)[:200] + ["</s>"] for x in texts]
    out = t.translate_batch(toks, beam_size=4, max_decoding_length=96, repetition_penalty=1.2, no_repeat_ngram_size=3)
    return [g.decode([p for p in o.hypotheses[0] if p != "</s>"]).replace("▁", " ").strip() for o in out]

def pairs():
    flagship = [p for p in os.listdir(args.models) if os.path.isfile(os.path.join(args.models, p, "model.bin"))] if os.path.isdir(args.models) else []
    return sorted(flagship) + sorted(opus_pairs())

class H(BaseHTTPRequestHandler):
    def _send(self, code, data):
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("content-type", "application/json; charset=utf-8"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == "/pairs": return self._send(200, {"pairs": pairs()})
        self._send(404, {"error": "introuvable"})
    def do_POST(self):
        if self.path != "/translate": return self._send(404, {"error": "introuvable"})
        try:
            n = int(self.headers.get("content-length", "0"))
            if n > 65536: return self._send(413, {"error": "trop volumineux"})
            b = json.loads(self.rfile.read(n) or b"{}")
            pair, texts = b.get("pair", ""), b.get("texts", [])
            if not PAIR_RE.match(pair) or pair not in pairs(): return self._send(400, {"error": f"paire indisponible : {pair}"})
            if not isinstance(texts, list) or not all(isinstance(x, str) for x in texts) or len(texts) > 16: return self._send(400, {"error": "texts invalide"})
            t0 = time.time(); out = translate(pair, [x[:500] for x in texts])
            self._send(200, {"translations": out, "ms": round((time.time() - t0) * 1000)})
        except Exception as e:
            self._send(500, {"error": str(e)})
    def log_message(self, *a): pass

if __name__ == "__main__":
    # Chargement de toutes les paires AVANT d'écouter : la première demande d'un utilisateur ne doit
    # pas attendre le chargement d'un modèle (le moteur abandonne la traduction au bout de 4 s).
    for p in pairs():
        load(p)
    print(f"Service de traduction Flagship : http://127.0.0.1:{args.port} ({len(pairs())} paires)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), H).serve_forever()
