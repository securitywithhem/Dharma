#!/bin/bash
until curl -s http://ollama:11434/api/tags | grep -q "llama3"; do
  echo "Waiting for llama3 model..."
  sleep 5
done
until curl -s http://ollama:11434/api/tags | grep -q "nomic-embed-text"; do
  echo "Waiting for nomic-embed-text model..."
  sleep 5
done
echo "All models ready."
