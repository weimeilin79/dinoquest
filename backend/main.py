from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from google import genai
from google.genai import types
from typing import Optional
import os
import json
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth

# Load sensitive environment variables securely
load_dotenv()

ADMIN_EMAILS = [
    email.strip() for email in os.getenv("ADMIN_EMAILS", "").split(",") if email.strip()
]
LEADERBOARD_ENABLED = os.getenv("LEADERBOARD_ENABLED", "false").lower() == "true"

# Load sensitive environment variables securely
load_dotenv()

# Initialize Firebase Admin for the backend
if not firebase_admin._apps:
    firebase_admin.initialize_app()
db = firestore.client()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY is not set in backend/.env!")

client = genai.Client(
    api_key=api_key,
    http_options=types.HttpOptions(
        retry_options=types.HttpRetryOptions(
            initial_delay=1.0,
            attempts=5,
            http_status_codes=[408, 429, 500, 502, 503, 504],
        ),
        timeout=120 * 1000,
    ),
)

# Initialize FastAPI application
app = FastAPI(title="DinoQuest Secure Backend")

# Securely configure CORS to accept traffic exclusively from the React frontend port
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Explicitly permit Firebase OAuth Popups to communicate with the main window
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    return response


class GenerationRequest(BaseModel):
    habitat: str
    diet: str
    preferences: str
    userId: Optional[str] = None


class GameStartLog(BaseModel):
    userId: Optional[str] = None
    dino_type: str
    dino_name: str
    is_reuse: bool


class GameEndLog(BaseModel):
    userId: Optional[str] = None
    dino_type: str
    dino_name: str
    score: int
    coins: int
    won: bool
    speed: float


@app.post("/api/generate")
async def generate_dinosaur(request: GenerationRequest):
    try:
        # 1. Generate text details
        text_prompt = f"""Generate a unique dinosaur character for a kid's game.
        Habitat: {request.habitat}
        Diet: {request.diet}
        Preferences: {request.preferences}
        
        The dinosaur should have a name, a short educational description, and game stats (speed, health, jump) from 1 to 10.
        Assign it one of these types: Speedy, Tank, Balanced, Agile."""

        text_response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=text_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        # Robustly extract text content by filtering for parts that actually contain text
        text_content = "".join(
            part.text
            for part in text_response.candidates[0].content.parts
            if hasattr(part, "text") and part.text
        )
        details = json.loads(text_content)
        image_prompt = details.get(
            "imagePrompt",
            "A cute, friendly dinosaur with vibrant colors and use a random color as base color if the user does not specify any color.",
        )

        # 2. Generate Image — include user preferences (e.g. color) directly in the prompt
        img_prompt = (
            f"A high-quality 3D render of a cute cartoon dinosaur for a modern 3D kids game. "
            f"{image_prompt}. User's special requests: {request.preferences}. "
            f"Art style: 3D CGI, Pixar Disney style, smooth vibrant materials, soft studio lighting, high resolution 3D game asset. "
            f"Pure white background. Just the dinosaur, no ground, no shadows on the floor, or other objects. "
            f"It is in a dynamic running pose and facing right. "
            f"CRITICAL: Keep the colors highly vibrant and ensure it has colorful spots. Do NOT make the skin bumpy or realistic."
        )

        image_response = client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=img_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )

        # Extract base64 image bytes securely from the multimodal part, filtering for inline_data
        import base64

        image_part = next(
            (
                part
                for part in image_response.candidates[0].content.parts
                if hasattr(part, "inline_data") and part.inline_data
            ),
            None,
        )

        if not image_part:
            raise ValueError("No image data found in the multimodal response.")

        base64_img = base64.b64encode(image_part.inline_data.data).decode("utf-8")
        raw_image_url = f"data:{image_part.inline_data.mime_type};base64,{base64_img}"

        # Log creation telemetry for Log Router -> BigQuery analysis
        print(
            json.dumps(
                {
                    "event": "DINO_CREATED",
                    "userId": request.userId,
                    "habitat": request.habitat,
                    "diet": request.diet,
                    "preferences": request.preferences,
                    "generated_name": details.get("name"),
                    "generated_type": details.get("type"),
                    "generated_description": details.get("description"),
                    "speed_stat": details.get("stats", {}).get("speed")
                    if "stats" in details
                    else None,
                }
            ),
            flush=True,
        )

        # Return merged payload identically format to what the frontend expects
        return {"details": details, "rawImageUrl": raw_image_url}

    except Exception as e:
        print(f"Backend Generation Error: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to securely generate Dinosaur payload."
        )


# ====================================================================\n# TELEMETRY LOGGING ENDPOINTS\n# ====================================================================\n\n\n@app.post(\"/api/log/game_start\")\nasync def log_game_start(log_data: GameStartLog):\n    print(\n        json.dumps(\n            {\n                \"event\": \"GAME_START\",\n                \"userId\": log_data.userId,\n                \"dino_type\": log_data.dino_type,\n                \"dino_name\": log_data.dino_name,\n                \"is_reuse\": log_data.is_reuse,\n            }\n        ),\n        flush=True,\n    )\n    return {\"status\": \"logged\"}\n\n\n@app.post(\"/api/log/game_end\")\nasync def log_game_end(log_data: GameEndLog):\n    print(\n        json.dumps(\n            {\n                \"event\": \"GAME_END\",\n                \"userId\": log_data.userId,\n                \"dino_type\": log_data.dino_type,\n                \"dino_name\": log_data.dino_name,\n                \"score\": log_data.score,\n                \"coins\": log_data.coins,\n                \"won\": log_data.won,\n                \"speed\": log_data.speed,\n            }\n        ),\n        flush=True,\n    )\n    return {\"status\": \"logged\"}\n\n\n# ====================================================================\n# LEADERBOARD\n# ====================================================================\n\n\n@app.get(\"/api/leaderboard/status\")\nasync def get_leaderboard_status(authorization: str = Header(None)):\n    is_admin = False\n    if authorization and authorization.startswith(\"Bearer \"):\n        token = authorization.split(\"Bearer \")[1]\n        try:\n            decoded = fb_auth.verify_id_token(token)\n            if decoded.get(\"email\") in ADMIN_EMAILS:\n                is_admin = True\n        except Exception:\n            pass\n\n    return {\"enabled\": LEADERBOARD_ENABLED, \"isAdmin\": is_admin}\n\n\n@app.get(\"/api/leaderboard\")\nasync def get_leaderboard(authorization: str = Header(None)):\n    if not authorization or not authorization.startswith(\"Bearer \"):\n        raise HTTPException(status_code=401, detail=\"Unauthorized\")\n\n    token = authorization.split(\"Bearer \")[1]\n    try:\n        decoded = fb_auth.verify_id_token(token)\n    except Exception:\n        raise HTTPException(status_code=401, detail=\"Invalid token\")\n\n    is_admin = decoded.get(\"email\") in ADMIN_EMAILS\n    if not LEADERBOARD_ENABLED and not is_admin:\n        raise HTTPException(status_code=403, detail=\"Leaderboard is currently disabled\")\n\n    # Fetch only top 100\n    docs = db.collection(\"scores\").order_by(\"score\", direction=\"DESCENDING\").limit(100).get()\n\n    scores = []\n    for doc in docs:\n        data = doc.to_dict()\n        data[\"id\"] = doc.id\n        scores.append(data)\n\n    return {\"status\": \"success\", \"leaderboard\": scores}\n\n\n# ====================================================================\n# STATIC REACT FRONTEND INTEGRATION\n# ====================================================================\n\n\n# Silence favicon logs and prevent serving HTML as an image\n@app.get(\"/favicon.ico\", include_in_schema=False)\nasync def favicon():\n    from fastapi import Response\n\n    return Response(status_code=204)\n\n\n# 1. Provide absolute direct access internally to the Vite compiled assets\napp.mount(\"/assets\", StaticFiles(directory=\"../frontend/dist/assets\"), name=\"assets\")\n\n\n# 2. Establish a Catch-All mechanism for React-Router SPAs\n@app.get(\"/{full_path:path}\")\nasync def serve_react_app(full_path: str, request: Request):\n    import os\n\n    target_path = f\"../frontend/dist/{full_path}\"\n\n    # If the user asks for a specific root file (like vite.svg), serve it\n    if os.path.exists(target_path) and os.path.isfile(target_path):\n        return FileResponse(target_path)\n\n    # Otherwise, fallback gracefully explicitly to index.html and let React build the UI!\n    return FileResponse(\"../frontend/dist/index.html\")\n\n\nif __name__ == \"__main__\":\n    import uvicorn\n\n    uvicorn.run(app, host=\"0.0.0.0\", port=8000)\n",relative_file_path: