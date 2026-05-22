#!/bin/bash
echo "🚀 Iniciando Bot Divulgação..."
while true; do
  node index.js
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Bot encerrado normalmente."
    break
  fi
  echo "⚠️ Bot encerrou com código $EXIT_CODE. Reiniciando em 5s..."
  sleep 5
done
