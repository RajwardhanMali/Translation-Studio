"""
Translation Studio — FastAPI Application Entry Point.

Registers all routers and configures middleware, logging, and startup events.
"""

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

from app.routers.upload      import router as upload_router
from app.routers.document    import router as document_router
from app.routers.validation  import router as validation_router
from app.routers.translation import router as translation_router
from app.routers.review      import router as review_router
from app.routers.glossary    import router as glossary_router
from app.routers.export      import router as export_router


# ---------------------------------------------------------------------------
# Startup / shutdown lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Pre-loads heavy models on startup so the first request is fast.
    """
    logger.info("=== Translation Studio starting up ===")

    # Pre-load spaCy model
    try:
        from app.services.segmenter import get_nlp
        get_nlp()
        logger.info("spaCy model ready.")
    except Exception as e:
        logger.warning(f"spaCy model not pre-loaded: {e}")

    # Pre-load sentence-transformer encoder
    try:
        from app.utils.embeddings import get_encoder
        get_encoder()
        logger.info("Sentence-transformer encoder ready.")
    except Exception as e:
        logger.warning(f"Encoder not pre-loaded: {e}")

    # Pre-load FAISS translation memory
    try:
        from app.services.rag_engine import get_tm
        get_tm()
        logger.info("FAISS translation memory ready.")
    except Exception as e:
        logger.warning(f"FAISS TM not pre-loaded: {e}")

    logger.info("=== Translation Studio ready ===")
    yield
    logger.info("=== Translation Studio shutting down ===")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Translation Studio API",
    description=(
        "AI-powered translation backend with RAG, Translation Memory, "
        "Glossary enforcement, and Continuous Learning."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS (permissive for MVP — restrict in production)
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Register routers
# ---------------------------------------------------------------------------

app.include_router(upload_router)
app.include_router(document_router)
app.include_router(validation_router)
app.include_router(translation_router)
app.include_router(review_router)
app.include_router(glossary_router)
app.include_router(export_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
async def health_check():
    """Quick liveness probe."""
    return {"status": "ok", "service": "translation-studio"}


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Check server logs."},
    )
