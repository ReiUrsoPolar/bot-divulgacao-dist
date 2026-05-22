#!/bin/bash
echo "🚀 Iniciando Bot Divulgação..."

# Carrega .env se existir (cópia privada do criador)
if [ -f .env ]; then
  NODE_ENV_FLAG="--env-file=.env"
else
  NODE_ENV_FLAG=""
fi

while true; do
  node $NODE_ENV_FLAG index.js
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Bot encerrado normalmente."
    break
  fi
  echo "⚠️ Bot encerrou com código $EXIT_CODE. Reiniciando em 5s..."
  sleep 5
done
