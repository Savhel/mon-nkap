"""Serveur local optionnel pour Meta Omnilingual ASR, avec indication de langue."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from threading import Lock
from urllib.parse import parse_qs, urlsplit
import wave

from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline
from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs

MAX_AUDIO_BYTES = 640_044
MAX_SAMPLES = 20 * 16_000
LANGUAGES = frozenset(supported_langs)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--port", type=int, default=8092)
    args.add_argument("--model", default="omniASR_LLM_300M_v2")
    config = args.parse_args()
    if not config.model.startswith("omniASR_LLM_") or config.model.endswith("_ZS"):
        args.error("--model doit désigner un modèle LLM-ASR à indication de langue")
    pipeline = ASRInferencePipeline(model_card=config.model)
    decoding = Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            # Les requêtes audio ne sont pas journalisées.
            return

        def send_json(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/health":
                return self.send_json(200, {"model": config.model, "languageConditioning": True})
            self.send_json(404, {"error": "introuvable"})

        def do_POST(self):
            url = urlsplit(self.path)
            if url.path != "/transcribe":
                return self.send_json(404, {"error": "introuvable"})
            lang = parse_qs(url.query).get("lang", [""])[0]
            if lang not in LANGUAGES:
                return self.send_json(400, {"error": "langue_non_prise_en_charge"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.send_json(400, {"error": "taille_invalide"})
            if not 44 < size <= MAX_AUDIO_BYTES:
                return self.send_json(413, {"error": "taille_audio_invalide"})
            try:
                blob = self.rfile.read(size)
                with wave.open(BytesIO(blob)) as clip:
                    if (clip.getnchannels(), clip.getsampwidth(), clip.getframerate()) != (1, 2, 16000):
                        raise ValueError("Format WAV invalide")
                    if not 0 < clip.getnframes() <= MAX_SAMPLES or len(clip.readframes(clip.getnframes())) != clip.getnframes() * 2:
                        raise ValueError("Taille WAV invalide")
            except (EOFError, ValueError, wave.Error):
                return self.send_json(422, {"error": "audio_invalide"})
            if not decoding.acquire(blocking=False):
                return self.send_json(429, {"error": "modele_occupe"})
            try:
                text = pipeline.transcribe([blob], lang=[lang], batch_size=1)[0]
                result = {"text": text, "model": config.model, "languageHint": lang}
            except Exception:
                return self.send_json(503, {"error": "transcription_indisponible"})
            finally:
                decoding.release()
            self.send_json(200, result)

    print(f"Omnilingual ASR ({config.model}) sur 127.0.0.1:{config.port}", flush=True)
    with ThreadingHTTPServer(("127.0.0.1", config.port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
