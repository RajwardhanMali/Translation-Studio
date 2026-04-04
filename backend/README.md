# 🌐 Syntra AI : AI Translation Studio — Backend API

AI-powered translation backend built with FastAPI, FAISS, spaCy, sentence-transformers, and Groq (Qwen).

---

## 📁 Project Structure

```
backend/
├── app/
│   ├── main.py                  # FastAPI app, router registration, lifespan
│   ├── routers/
│   │   ├── upload.py            # POST /upload
│   │   ├── document.py          # GET  /document/{id}
│   │   ├── validation.py        # POST /validate
│   │   ├── translation.py       # POST /translate
│   │   ├── review.py            # GET  /segments/{doc_id}, POST /approve
│   │   └── glossary.py          # GET/POST /glossary
│   ├── services/
│   │   ├── parser.py            # PDF + DOCX parsing
│   │   ├── segmenter.py         # spaCy sentence → phrase segmentation
│   │   ├── validator.py         # Spell check, grammar, consistency
│   │   ├── rag_engine.py        # FAISS TM — search, classify, store
│   │   ├── glossary_engine.py   # Glossary load, inject, enforce
│   │   ├── learning.py          # Continuous learning (TM + JSONL)
│   │   └── llm_service.py       # Groq API / Qwen translation
│   ├── models/
│   │   └── schemas.py           # All Pydantic request/response models
│   ├── utils/
│   │   ├── file_handler.py      # JSON persistence, path helpers
│   │   └── embeddings.py        # Sentence-transformer encoder singleton
│   └── data/
│       ├── uploads/             # Raw uploaded files
│       ├── parsed_docs/         # Parsed block JSON
│       ├── segmented_docs/      # Segmented + translated JSON
│       ├── faiss_index/         # FAISS TM index + metadata
│       ├── datasets/
│       │   └── fine_tune.jsonl  # Continuous learning dataset
│       └── glossary.json        # Glossary terms + style rules
├── requirements.txt
├── .env.example
└── README.md
```

---

## ⚙️ Setup & Installation

### 1. Clone / enter project

```bash
cd backend
```

### 2. Create virtual environment

```bash
python -m venv .venv
source .venv/bin/activate        # Linux / macOS
# .venv\Scripts\activate         # Windows
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Download spaCy model

```bash
python -m spacy download en_core_web_sm
```

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY
```

### 6. Start the server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive docs: http://localhost:8000/docs

---

## 🚀 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload PDF or DOCX for parsing & segmentation |
| GET | `/document/{id}` | Retrieve parsed document blocks |
| POST | `/validate` | Validate source text (spell, grammar, consistency) |
| POST | `/translate` | Translate document segments via RAG + LLM |
| GET | `/segments/{doc_id}` | List segments (filterable by status/type) |
| POST | `/approve` | Approve / correct a segment → triggers learning |
| GET | `/glossary` | Get all glossary terms + style rules |
| POST | `/glossary` | Add a new glossary term |
| GET | `/health` | Service liveness probe |

---

## 📋 Example Requests

### 1. Upload a document

```bash
curl -X POST http://localhost:8000/upload \
  -F "file=@my_document.pdf"
```

**Response:**
```json
{
  "document_id": "3f7a1c2e-...",
  "filename": "my_document.pdf",
  "file_type": "pdf",
  "blocks_parsed": 42,
  "message": "Document uploaded and processed successfully. 87 segments created."
}
```

---

### 2. Get parsed document

```bash
curl http://localhost:8000/document/3f7a1c2e-...
```

---

### 3. Validate source text

**Validate a full document:**
```bash
curl -X POST http://localhost:8000/validate \
  -H "Content-Type: application/json" \
  -d '{
    "document_id": "3f7a1c2e-...",
    "auto_fix": true
  }'
```

**Validate arbitrary text:**
```bash
curl -X POST http://localhost:8000/validate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This  is a test sentance with  double spaces.",
    "auto_fix": true
  }'
```

**Response:**
```json
[{
  "text": "This  is a test sentance with  double spaces.",
  "issues": [
    {
      "issue_type": "spelling",
      "issue": "Possible misspelling: 'sentance'",
      "suggestion": "Did you mean: 'sentence'?",
      "severity": "error"
    },
    {
      "issue_type": "double_space",
      "issue": "Double space detected",
      "suggestion": "Replace with a single space",
      "severity": "warning"
    }
  ],
  "auto_fixed_text": "This is a test sentance with double spaces.",
  "has_errors": true,
  "has_warnings": true
}]
```

---

### 4. Translate a document

```bash
curl -X POST http://localhost:8000/translate \
  -H "Content-Type: application/json" \
  -d '{
    "document_id": "3f7a1c2e-...",
    "target_language": "fr",
    "style_rules": ["Use formal register", "Avoid contractions"]
  }'
```

**Translate specific segments only:**
```bash
curl -X POST http://localhost:8000/translate \
  -H "Content-Type: application/json" \
  -d '{
    "document_id": "3f7a1c2e-...",
    "target_language": "fr",
    "segment_ids": ["seg-uuid-1", "seg-uuid-2"]
  }'
```

---

### 5. List segments

```bash
# All segments
curl http://localhost:8000/segments/3f7a1c2e-...

# Only reviewed segments
curl "http://localhost:8000/segments/3f7a1c2e-...?status=reviewed"

# Only sentence-type segments
curl "http://localhost:8000/segments/3f7a1c2e-...?type=sentence"
```

---

### 6. Approve a segment

**Approve as-is:**
```bash
curl -X POST http://localhost:8000/approve \
  -H "Content-Type: application/json" \
  -d '{
    "segment_id": "seg-uuid-1",
    "approved": true
  }'
```

**Approve with human correction:**
```bash
curl -X POST http://localhost:8000/approve \
  -H "Content-Type: application/json" \
  -d '{
    "segment_id": "seg-uuid-1",
    "correction": "Voici la traduction corrigée par un humain.",
    "approved": true
  }'
```

**Response:**
```json
{
  "segment_id": "seg-uuid-1",
  "status": "approved",
  "final_text": "Voici la traduction corrigée par un humain."
}
```

---

### 7. Get glossary

```bash
curl http://localhost:8000/glossary
```

---

### 8. Add glossary term

```bash
curl -X POST http://localhost:8000/glossary \
  -H "Content-Type: application/json" \
  -d '{
    "term": {
      "source": "cloud computing",
      "target": "informatique en nuage",
      "language": "fr",
      "domain": "technology",
      "notes": "Preferred over anglicism"
    }
  }'
```

---

## 🧠 Architecture: Translation Pipeline

```
Upload
  └─► Parse (PDF/DOCX) → Blocks
        └─► Segment (spaCy) → Sentences → Phrases

Translate
  └─► For each segment:
        1. Encode (BAAI/bge-small-en)
        2. Search FAISS TM
           ├── Exact (≥0.95) → Reuse TM translation
           ├── Fuzzy (0.75–0.95) → LLM adapts TM reference
           └── New  (<0.75)  → LLM translates from scratch
        3. Inject glossary + style rules into LLM prompt
        4. Post-process: enforce glossary constraints

Approve
  └─► final_text = correction OR translated_text
        └─► Update FAISS TM
              └─► Append to fine_tune.jsonl
```

---

## 🔑 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | ✅ | — | Groq API key |
| `GROQ_MODEL` | ❌ | `qwen-qwq-32b` | Groq model name |
| `LOG_LEVEL` | ❌ | `INFO` | Logging verbosity |

---

## 🛠 Troubleshooting

**spaCy model not found:**
```bash
python -m spacy download en_core_web_sm
```

**GROQ_API_KEY not set:**
```bash
export GROQ_API_KEY=gsk_...
```

**FAISS import error:**
```bash
pip install faiss-cpu
```

**PyMuPDF import error:**
```bash
pip install PyMuPDF
```
