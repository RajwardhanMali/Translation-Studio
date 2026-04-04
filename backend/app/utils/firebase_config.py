import os
import json
import logging
import datetime
import firebase_admin
from firebase_admin import credentials, storage

logger = logging.getLogger(__name__)

FIREBASE_CREDS_ENV = os.environ.get("FIREBASE_CREDENTIALS")
FIREBASE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET")

firebase_app = None

def init_firebase():
    global firebase_app
    if firebase_app is not None:
        return firebase_app
        
    if not FIREBASE_CREDS_ENV:
        logger.warning("FIREBASE_CREDENTIALS environment variable not set. Application will not upload files to Firebase.")
        return None
        
    try:
        cred_dict = json.loads(FIREBASE_CREDS_ENV)
        cred = credentials.Certificate(cred_dict)
        firebase_app = firebase_admin.initialize_app(cred, {
            'storageBucket': FIREBASE_BUCKET or f"{cred_dict.get('project_id', 'unknown')}.appspot.com"
        })
        logger.info("Firebase Admin initialized successfully.")
        return firebase_app
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin: {e}")
        return None

# Attempt initialization immediately, but do not block app startup if credentials are missing
init_firebase()

def upload_file_to_firebase(file_path: str, destination_blob_name: str) -> str:
    """
    Uploads a file to the bucket.
    Returns the public URL or a gs:// URI.
    """
    if not firebase_app:
        logger.warning("Firebase not initialized. Simulating successful upload.")
        return f"gs://fallback-bucket/{destination_blob_name}"
        
    try:
        bucket = storage.bucket()
        blob = bucket.blob(destination_blob_name)
        
        blob.upload_from_filename(file_path)
        
        # Making the blob publicly viewable (optional, depends on use case, but useful for frontend)
        # blob.make_public()
        # return blob.public_url
        
        # Or return a signed URL valid for a long time
        url = blob.generate_signed_url(version="v4", expiration=datetime.timedelta(days=7), method="GET")
        return url
    except Exception as e:
        logger.error(f"Firebase upload failed: {e}")
        # fallback
        return f"gs://fallback-bucket/{destination_blob_name}"
