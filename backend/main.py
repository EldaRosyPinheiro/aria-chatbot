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

sessions: dict = {}


# ══════════════════════════════════════════════════════════════
# HELPER — parse weather entries (dict or list)
# ══════════════════════════════════════════════════════════════

def parse_weather_entries(data):
    lines = []
    try:
        if isinstance(data, dict):
            for key, val in list(data.items())[:5]:
                if isinstance(val, dict):
                    lines.append(
                        f"  - {key}: "
                        f"Temp {val.get('temperature', val.get('temp', val.get('max_temp', 'N/A')))}°C, "
                        f"Humidity {val.get('humidity', 'N/A')}%, "
                        f"Condition: {val.get('condition', val.get('description', val.get('weather', 'N/A')))}, "
                        f"Rain: {val.get('rain', val.get('rainfall', val.get('precipitation', 'N/A')))} mm"
                    )
                else:
                    lines.append(f"  - {key}: {val}")
        elif isinstance(data, list):
            for item in data[:5]:
                if isinstance(item, dict):
                    lines.append(
                        f"  - {item.get('date', 'N/A')}: "
                        f"Temp {item.get('temperature', item.get('temp', 'N/A'))}°C, "
                        f"Humidity {item.get('humidity', 'N/A')}%, "
                        f"Condition: {item.get('condition', item.get('description', 'N/A'))}"
                    )
    except Exception:
        lines = ["  - Could not parse weather entries"]
    return lines


# ══════════════════════════════════════════════════════════════
# SYSTEM PROMPT BUILDER
# ══════════════════════════════════════════════════════════════

def build_system_prompt(
    active_crop=None,
    sensor_data=None,
    all_crops=None,
    weather_data=None
):
    # ── Active Crop ───────────────────────────────────────────
    if active_crop:
        crop_context = (
            "\nACTIVE CROP (currently being grown by user):\n"
            f"- Name: {active_crop.get('name', 'Unknown')}\n"
            f"- Growth Duration: {active_crop.get('growthDuration', 'Unknown')} days\n"
            f"- Activated Date: {active_crop.get('activatedDate', 'Unknown')}\n"
            f"- Required Temperature: {active_crop.get('temperature', 'Unknown')}\n"
            f"- Required Humidity: {active_crop.get('humidity', 'Unknown')}\n"
            f"- Nitrogen Required: {active_crop.get('nitrogen_min', 'N/A')} - {active_crop.get('nitrogen_optimal', 'N/A')} mg/kg\n"
            f"- Phosphorus Required: {active_crop.get('phosphorus_min', 'N/A')} - {active_crop.get('phosphorus_optimal', 'N/A')} mg/kg\n"
            f"- Potassium Required: {active_crop.get('potassium_min', 'N/A')} - {active_crop.get('potassium_optimal', 'N/A')} mg/kg\n"
        )
    else:
        crop_context = "\nNo active crop selected by the user.\n"

    # ── All Crops ─────────────────────────────────────────────
    if all_crops and len(all_crops) > 0:
        crops_list = "\n".join([
            f"- {c.get('name','?')}: "
            f"N({c.get('nitrogen_min','?')}-{c.get('nitrogen_optimal','?')} mg/kg), "
            f"P({c.get('phosphorus_min','?')}-{c.get('phosphorus_optimal','?')} mg/kg), "
            f"K({c.get('potassium_min','?')}-{c.get('potassium_optimal','?')} mg/kg), "
            f"Temp:{c.get('temperature','?')}, "
            f"Humidity:{c.get('humidity','?')}, "
            f"Duration:{c.get('growthDuration','?')} days"
            for c in all_crops
        ])
        all_crops_context = f"\nALL AVAILABLE CROPS IN CROPIZIDE PLATFORM:\n{crops_list}\n"
    else:
        all_crops_context = "\nNo crop database available.\n"

    # ── Live Sensor Data ──────────────────────────────────────
    if sensor_data:
        sensor_context = (
            "\nLIVE SENSOR READINGS (from user's field right now):\n"
            f"- Air Temperature: {sensor_data.get('air_temperature', sensor_data.get('temperature', 'N/A'))} C\n"
            f"- Humidity: {sensor_data.get('humidity', 'N/A')} %\n"
            f"- Soil Moisture: {sensor_data.get('soil_moisture_percentage', sensor_data.get('soil_moisture', 'N/A'))} %\n"
            f"- Soil Temperature: {sensor_data.get('soil_temperature', sensor_data.get('soilTemperature', 'N/A'))} C\n"
            f"- Atmospheric Pressure: {sensor_data.get('pressure', sensor_data.get('atm_pressure', 'N/A'))} hPa\n"
            f"- Nitrogen (N): {sensor_data.get('nitrogen', sensor_data.get('N', 'N/A'))} mg/kg\n"
            f"- Phosphorus (P): {sensor_data.get('phosphorus', sensor_data.get('P', 'N/A'))} mg/kg\n"
            f"- Potassium (K): {sensor_data.get('potassium', sensor_data.get('K', 'N/A'))} mg/kg\n"
        )
    else:
        sensor_context = "\nNo live sensor data available.\n"

    # ── Weather Data ──────────────────────────────────────────
    if weather_data:
        historical = weather_data.get('historical') or {}
        forecast   = weather_data.get('forecast')   or {}

        hist_lines = parse_weather_entries(historical)
        fore_lines = parse_weather_entries(forecast)

        hist_text = "\n".join(hist_lines) if hist_lines else "  - No historical data"
        fore_text = "\n".join(fore_lines) if fore_lines else "  - No forecast data"

        weather_context = (
            "\nWEATHER DATA:\n"
            "Past Weather:\n" + hist_text + "\n"
            "Weather Forecast:\n" + fore_text + "\n"
        )
    else:
        weather_context = "\nNo weather data available.\n"

    # ── Full Prompt ───────────────────────────────────────────
    return (
        "You are ARIA — the intelligent farming assistant for Cropizide, a smart agriculture platform.\n\n"
        "You are an expert in crop cultivation, soil health, fertilizers, irrigation, pest management,\n"
        "interpreting sensor data, and Kerala/Indian/tropical agriculture.\n"
        + crop_context
        + all_crops_context
        + sensor_context
        + weather_context
        + "\nLANGUAGE RULES (CRITICAL — follow strictly):\n"
        "1. ALWAYS detect the language of the user's LATEST message only.\n"
        "2. Reply in the EXACT same language the user used:\n"
        "   - English text → reply ONLY in English\n"
        "   - Malayalam script (മലയാളം) → reply ONLY in Malayalam\n"
        "   - Hindi script (हिंदी) → reply ONLY in Hindi\n"
        "   - Tamil script (தமிழ்) → reply ONLY in Tamil\n"
        "   - Telugu script (తెలుగు) → reply ONLY in Telugu\n"
        "3. NEVER switch languages unless the user switches first.\n"
        "4. DEFAULT language is English if detection is uncertain.\n"
        "5. Do NOT mix languages in the same response.\n"
        "6. Use natural, simple language a farmer can understand.\n"
        "\nFORMATTING RULES (CRITICAL):\n"
        "7. NEVER use asterisks (*) or double asterisks (**) anywhere in your response.\n"
        "8. NEVER use markdown bold or italic formatting.\n"
        "9. Use plain dash (-) for bullet points only.\n"
        "10. Use plain text only — no special characters for emphasis.\n"
        "\nFARMING INSTRUCTIONS:\n"
        "11. When sensor data is available, USE the actual numbers in your advice.\n"
        "12. When active crop info is available, tailor answers for that specific crop.\n"
        "13. When asked about any crop, use the ALL AVAILABLE CROPS data.\n"
        "14. When asked about weather, use the WEATHER DATA above — never say data is unavailable if it is provided.\n"
        "15. If sensor values are abnormal, WARN the farmer and suggest fixes.\n"
        "16. Keep responses under 150 words. Use bullet points with dash (-).\n"
        "17. Always prioritize the farmer's crop health and yield.\n"
    )


# ══════════════════════════════════════════════════════════════
# MODELS
# ══════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    session_id:   str
    message:      str
    active_crop:  Optional[dict] = None
    sensor_data:  Optional[dict] = None
    all_crops:    Optional[list] = None
    weather_data: Optional[dict] = None

class TTSRequest(BaseModel):
    text: str


# ══════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════

@app.get("/session")
def create_session():
    sid = str(uuid.uuid4())
    sessions[sid] = {"history": []}
    return {"session_id": sid}


@app.post("/chat")
async def chat(req: ChatRequest):
    sid = req.session_id
    if sid not in sessions:
        sessions[sid] = {"history": []}

    system_prompt = build_system_prompt(
        active_crop  = req.active_crop,
        sensor_data  = req.sensor_data,
        all_crops    = req.all_crops,
        weather_data = req.weather_data
    )

    messages = [{"role": "system", "content": system_prompt}]
    messages += sessions[sid]["history"][-12:]
    messages.append({"role": "user", "content": req.message})

    try:
        response = client.chat.completions.create(
            model       = "llama-3.3-70b-versatile",
            messages    = messages,
            max_tokens  = 512,
            temperature = 0.7,
        )
        reply = response.choices[0].message.content

        # Strip any asterisks that slip through
        reply = reply.replace("**", "").replace("*", "")

        sessions[sid]["history"].append({"role": "user",      "content": req.message})
        sessions[sid]["history"].append({"role": "assistant", "content": reply})
        return {"reply": reply, "session_id": sid, "status": "ok"}

    except Exception as e:
        return {"reply": f"Error: {str(e)}", "status": "error"}


@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "cleared"}


# ══════════════════════════════════════════════════════════════
# LANGUAGE DETECTION
# ══════════════════════════════════════════════════════════════

def detect_language(text: str) -> str:
    if re.search(r'[\u0D00-\u0D7F]', text): return 'ml'  # Malayalam
    if re.search(r'[\u0900-\u097F]', text): return 'hi'  # Hindi
    if re.search(r'[\u0B80-\u0BFF]', text): return 'ta'  # Tamil
    if re.search(r'[\u0C00-\u0C7F]', text): return 'te'  # Telugu
    return 'en'                                           # English (default)


# ══════════════════════════════════════════════════════════════
# TTS — supports all 5 languages
# ══════════════════════════════════════════════════════════════

@app.post("/tts")
async def text_to_speech(req: TTSRequest):
    try:
        lang_code = detect_language(req.text)
        tts       = gTTS(text=req.text, lang=lang_code, slow=False)
        audio_fp  = io.BytesIO()
        tts.write_to_fp(audio_fp)
        audio_fp.seek(0)
        return StreamingResponse(audio_fp, media_type="audio/mpeg")
    except Exception as e:
        return {"error": str(e)}


# ══════════════════════════════════════════════════════════════
# HEALTH / PING
# ══════════════════════════════════════════════════════════════

@app.get("/health")
@app.get("/ping")
def health():
    return {"status": "healthy"}
