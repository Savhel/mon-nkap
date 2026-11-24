#!/usr/bin/env bash
# Télécharge les modèles OPUS-MT (Apache-2.0) avec reprise automatique, puis les convertit en CTranslate2 int8.
# Robuste aux connexions lentes ou coupées : chaque fichier reprend là où il s'est arrêté.
#   bash tools/fetch-opus.sh
set -u
cd "$(dirname "$0")/.."
declare -A MODELS=(
  [fra-bnt]=Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-bnt
  [mul-fra]=Helsinki-NLP/opus-mt-tc-bible-big-mul-deu_eng_fra_por_spa
)
for name in fra-bnt mul-fra; do
  repo=${MODELS[$name]}
  [ -f "models/opus/$name/model.bin" ] && { echo "déjà prêt : $name"; continue; }
  src="models/opus-src/$name"; mkdir -p "$src"
  for f in config.json generation_config.json tokenizer_config.json special_tokens_map.json vocab.json source.spm target.spm model.safetensors; do
    until curl -sfL -C - --retry 20 --retry-delay 5 --connect-timeout 30 --speed-limit 1024 --speed-time 60 -o "$src/$f" "https://huggingface.co/$repo/resolve/main/$f"; do
      code=$?; [ $code -eq 33 ] && break   # 33 : fichier déjà complet (reprise impossible car rien à reprendre)
      echo "  $name/$f : interrompu (code $code), nouvelle tentative dans 10 s"; sleep 10
    done
    echo "  $name/$f : $(du -h "$src/$f" | cut -f1)"
  done
  .venv/bin/ct2-transformers-converter --model "$src" --output_dir "models/opus/$name" --quantization int8 --copy_files source.spm target.spm \
    && echo "converti : $name ($(du -sh models/opus/$name | cut -f1))" && rm -r "$src"
done
