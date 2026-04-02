import base64
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

def encode_image(image_path: Path) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def extract_text_from_image(image_path: Path) -> str:
    """Uses Groq's Vision model to OCR text from an image, or returns empty string if fallback."""
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if not groq_api_key:
        logger.debug("GROQ_API_KEY not set, skipping OCR.")
        return ""
    
    try:
        from groq import Groq
        client = Groq(api_key=groq_api_key)
        
        base64_image = encode_image(image_path)
        
        # Determine mime type
        ext = image_path.suffix.lower().lstrip(".")
        # Default to png or jpeg
        mime = f"image/{ext}" if ext in ["jpeg", "jpg", "png", "webp", "gif"] else "image/png"
        
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract all readable text from this image exactly as it appears. Do not describe the image. If there is no text, simply output '[NO_TEXT]'."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{base64_image}",
                            },
                        },
                    ],
                }
            ],
            model="llama-3.2-11b-vision-preview",
            temperature=0.1,
            max_tokens=1024
        )
        
        content = chat_completion.choices[0].message.content.strip()
        if content == "[NO_TEXT]" or not content:
            return ""
        return content
        
    except Exception as e:
        logger.warning(f"Vision OCR failed for {image_path.name}: {e}")
        return ""
