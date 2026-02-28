from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from groq import Groq
from gtts import gTTS
from dotenv import load_dotenv
from typing import Optional
import os
import uuid
import io
import re

load_dotenv()

app = FastAPI(title="ARIA — Cropizide Voice Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# In-memory session store
sessions: dict = {}

# ── System Prompt ──────────────────────────────────────────────
def build_system_prompt(active_crop: dict = None, sensor_data: dict = None) -> str:
    crop_context = ""
    sensor_context = ""

    if active_crop:
        crop_context = f"""
ACTIVE CROP INFORMATION:
- Crop Name: {active_crop.get('name', 'Unknown')}
- Crop Type: {active_crop.get('type', 'Unknown')}
- Growth Stage: {active_crop.get('stage', 'Unknown')}
- Planting Date: {active_crop.get('plantingDate', 'Unknown')}
- Additional Info: {active_crop.get('notes', 'None')}
"""
    else:
        crop_context = "\nNo active crop selected by the user.\n"

    if sensor_data:
        sensor_context = f"""
LIVE SENSOR DATA (from field):
- Temperature: {sensor_data.get('temperature', 'N/A')} °C
- Humidity: {sensor_data.get('humidity', 'N/A')} %
- Soil Moisture: {sensor_data.get('soilMoisture', sensor_data.get('soil_moisture', 'N/A'))} %
- Soil Temperature: {sensor_data.get('soilTemperature', sensor_data.get('soil_temp', 'N/A'))} °C
- pH Level: {sensor_data.get('ph', sensor_data.get('pH', 'N/A'))}
- Atmospheric Pressure: {sensor_data.get('pressure', 'N/A')} hPa
- Nitrogen (N): {sensor_data.get('nitrogen', sensor_data.get('N', 'N/A'))} mg/kg
- Phosphorus (P): {sensor_data.get('phosphorus', sensor_data.get('P', 'N/A'))} mg/kg
- Potassium (K): {sensor_data.get('potassium', sensor_data.get('K', 'N/A'))} mg/kg
"""
    else:
        sensor_context = "\nNo live sensor data available.\n"

    return f"""You are ARIA — the intelligent farming assistant for Cropizide, a smart agriculture platform.

You are an expert in:
- Crop cultivation, farming techniques, and best practices
- Soil health, fertilizers, irrigation, and pest management
- Interpreting sensor data (temperature, humidity, soil moisture, pH, NPK levels, pressure)
- Giving specific advice based on real-time field conditions
- Kerala farming, Indian agriculture, and tropical crops

{crop_context}
{sensor_context}

INSTRUCTIONS:
1. ALWAYS detect the language the user writes or speaks in.
2. ALWAYS reply in the EXACT same language the user used (Malayalam or English or any other).
3. When sensor data is available, USE IT to give specific, actionable advice.
4. When crop info is available, tailor your answers specifically for that crop.
5. If sensor values are abnormal (e.g. low soil moisture, wrong pH), WARN the farmer and suggest fixes.
6. Be concise, friendly, and practical — like a knowledgeable farming expert.
7. Keep responses clear for text-to-speech reading.
8. Always prioritize the farmer's crop health and yield.

Examples of specific advice:
- If soil moisture is low → suggest irrigation immediately
- If pH is too acidic/alkaline → suggest lime or sulfur treatment
- If temperature is too high → suggest mulching or shade nets
- If NPK is low → recommend specific fertilizers
"""

# ── Models ─────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    session_id: str
    message: str
    active_crop: Optional[dict] = None
    sensor_data: Optional[dict] = None

class TTSRequest(BaseModel):
    text: str


# ── Session ────────────────────────────────────────────────────
@app.get("/session")
def create_session():
    sid = str(uuid.uuid4())
    sessions[sid] = {
        "history": [],
        "active_crop": None,
        "sensor_data": None
    }
    return {"session_id": sid}


# ── Chat ───────────────────────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    sid = req.session_id

    if sid not in sessions:
        sessions[sid] = {
            "history": [],
            "active_crop": None,
            "sensor_data": None
        }

    # Update context with latest crop and sensor data from frontend
    if req.active_crop:
        sessions[sid]["active_crop"] = req.active_crop
    if req.sensor_data:
        sessions[sid]["sensor_data"] = req.sensor_data

    active_crop  = sessions[sid].get("active_crop")
    sensor_data  = sessions[sid].get("sensor_data")

    # Build system prompt with crop + sensor context
    system_prompt = build_system_prompt(active_crop, sensor_data)

    # Build messages list
    messages = [{"role": "system", "content": system_prompt}]
    messages += sessions[sid]["history"][-12:]  # last 12 messages for context
    messages.append({"role": "user", "content": req.message})

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            max_tokens=1024,
            temperature=0.7,
        )

        reply = response.choices[0].message.content

        # Save to history
        sessions[sid]["history"].append({"role": "user", "content": req.message})
        sessions[sid]["history"].append({"role": "assistant", "content": reply})

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
    return 'en'


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
    
