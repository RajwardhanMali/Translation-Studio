import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load environment variables (from .env or system env)
load_dotenv()

# Prioritize DATABASE_URL, otherwise try to read from frontend's .env if necessary,
# but we expect the user to provide it or the orchestrator to set it up.
DATABASE_URL = os.environ.get("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set. Please set it to a valid PostgreSQL connection string.")

# SQLAlchemy might prefer postgresql:// instead of postgres://, but since we are using psycopg2:
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Ensure psycopg2 driver is explicitly used if just postgresql:// is provided
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # recommended to safely handle disconnections
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
