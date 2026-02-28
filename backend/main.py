from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from groq import Groq
from gtts import gTTS
from dotenv import load_dotenv
import os
import uuid
import io
import re

load_dotenv()

app = FastAPI(title="Multilingual Voice Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# In-memory session store
sessions: dict = {}

SYSTEM_PROMPT = """You are ARIA — a warm, intelligent multilingual voice assistant.

Rules:
1. ALWAYS detect the language the user writes or speaks in.
2. ALWAYS reply in the EXACT same language the user used.
3. Be concise, friendly, and helpful.
4. If the user switches language mid-conversation, switch too.
5. You support all world languages including English, Spanish, French, German, Hindi, Arabic, Chinese, Japanese, Korean, Portuguese, Russian, Malayalam, Tamil, Telugu, and many more.
6. Keep responses conversational and clear — they will be read aloud via text-to-speech.
"""


# ── Models ─────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    session_id: str
    message: str

class TTSRequest(BaseModel):
    text: str


# ── Session ────────────────────────────────────────────────────
@app.get("/session")
def create_session():
    sid = str(uuid.uuid4())
    sessions[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]
    return {"session_id": sid}


# ── Chat ───────────────────────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    sid = req.session_id

    if sid not in sessions:
        sessions[sid] = [{"role": "system", "content": SYSTEM_PROMPT}]

    sessions[sid].append({"role": "user", "content": req.message})

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=sessions[sid],
            max_tokens=1024,
            temperature=0.7,
        )

        reply = response.choices[0].message.content
        sessions[sid].append({"role": "assistant", "content": reply})

        return {
            "reply": reply,
            "session_id": sid,
            "status": "ok"
        }

    except Exception as e:
        return {"reply": f"Error: {str(e)}", "status": "error"}


# ── Clear Session ──────────────────────────────────────────────
@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "cleared"}


# ── Language Detection ─────────────────────────────────────────
def detect_language(text: str) -> str:
    if re.search(r'[\u0D00-\u0D7F]', text): return 'ml'  # Malayalam
    if re.search(r'[\u0900-\u097F]', text): return 'hi'  # Hindi
    if re.search(r'[\u0B80-\u0BFF]', text): return 'ta'  # Tamil
    if re.search(r'[\u0C00-\u0C7F]', text): return 'te'  # Telugu
    if re.search(r'[\u0600-\u06FF]', text): return 'ar'  # Arabic
    if re.search(r'[\u3040-\u30FF]', text): return 'ja'  # Japanese
    if re.search(r'[\uAC00-\uD7AF]', text): return 'ko'  # Korean
    if re.search(r'[\u4E00-\u9FFF]', text): return 'zh'  # Chinese
    return 'en'  # Default English


# ── Text to Speech ─────────────────────────────────────────────
@app.post("/tts")
async def text_to_speech(req: TTSRequest):
    try:
        lang_code = detect_language(req.text)
        tts = gTTS(text=req.text, lang=lang_code, slow=False)
        audio_fp = io.BytesIO()
        tts.write_to_fp(audio_fp)
        audio_fp.seek(0)
        return StreamingResponse(audio_fp, media_type="audio/mpeg")
    except Exception as e:
        return {"error": str(e)}


# ── Health Check ───────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "healthy"}