#!/usr/bin/env bash
# setup.sh — One-shot setup for Translation Studio backend
# Usage: bash setup.sh

set -e

echo "🔧 Creating virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

echo "📦 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo "🧠 Downloading spaCy model..."
python -m spacy download en_core_web_sm

echo "📝 Creating .env from template..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  → .env created. Edit it and add your GROQ_API_KEY."
else
  echo "  → .env already exists, skipping."
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env and set GROQ_API_KEY=your_key_here"
echo "  2. source .venv/bin/activate"
echo "  3. uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo "  4. Open http://localhost:8000/docs"
