import os
import json
import logging
import datetime
import firebase_admin
from firebase_admin import credentials, storage

logger = logging.getLogger(__name__)

FIREBASE_CREDS_ENV = os.environ.get("FIREBASE_CREDENTIALS")
FIREBASE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET", "").strip()

firebase_app = None
_bucket_name: str = ""

def init_firebase():
    global firebase_app, _bucket_name
    if firebase_app is not None:
        return firebase_app
        
    if not FIREBASE_CREDS_ENV:
        logger.warning("FIREBASE_CREDENTIALS not set — uploads will use fallback path.")
        return None
        
    try:
        cred_dict = json.loads(FIREBASE_CREDS_ENV)
        cred = credentials.Certificate(cred_dict)

        # Determine bucket name.
        # New Firebase projects (post Oct 2024) use the format: project-id.firebasestorage.app
        # Old projects use: project-id.appspot.com
        # We always prefer the explicit env var.
        _bucket_name = FIREBASE_BUCKET or f"{cred_dict.get('project_id', 'unknown')}.appspot.com"
        
        firebase_app = firebase_admin.initialize_app(cred, {
            "storageBucket": _bucket_name
        })
        logger.info(f"Firebase Admin initialized. Bucket: {_bucket_name}")
        return firebase_app
    except ValueError as e:
        # App already initialised (can happen during dev with hot-reload)
        logger.warning(f"Firebase already initialized: {e}")
        firebase_app = firebase_admin.get_app()
        return firebase_app
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin: {e}")
        return None


# Attempt initialization at import time
init_firebase()


def upload_file_to_firebase(file_path: str, destination_blob_name: str) -> str:
    """
    Uploads a file to Firebase Storage.
    Returns a signed URL valid for 7 days, or a gs:// fallback URI on error.
    """
    if not firebase_app:
        logger.warning("Firebase not initialized — skipping upload.")
        return f"gs://fallback-bucket/{destination_blob_name}"
        
    try:
        # Explicitly pass bucket name to avoid any default-resolution ambiguity.
        bucket = storage.bucket(_bucket_name)
        blob = bucket.blob(destination_blob_name)
        blob.upload_from_filename(file_path)

        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(days=7),
            method="GET"
        )
        logger.info(f"Firebase upload OK: {destination_blob_name}")
        return url
    except Exception as e:
        logger.error(f"Firebase upload failed: {e}")
        return f"gs://fallback-bucket/{destination_blob_name}"
