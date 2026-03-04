from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from groq import Groq
from gtts import gTTS
from dotenv import load_dotenv
from typing import Optional, List
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


# ══════════════════════════════════════════════════════════════
# SYSTEM PROMPT BUILDER
# Uses: active crop, all crops, live sensors, weather
# ══════════════════════════════════════════════════════════════
def build_system_prompt(
    active_crop:  dict = None,
    sensor_data:  dict = None,
    all_crops:    list = None,
    weather_data: dict = None
) -> str:

    # ── Active Crop ───────────────────────────────────────────
    if active_crop:
        crop_context = f"""
ACTIVE CROP (currently being grown by user):
- Name: {active_crop.get('name', 'Unknown')}
- Growth Duration: {active_crop.get('growthDuration', 'Unknown')} days
- Activated Date: {active_crop.get('activatedDate', 'Unknown')}
- Required Temperature: {active_crop.get('temperature', 'Unknown')}
- Required Humidity: {active_crop.get('humidity', 'Unknown')}
- Nitrogen Required: {active_crop.get('nitrogen_min', 'N/A')} - {active_crop.get('nitrogen_optimal', 'N/A')} mg/kg
- Phosphorus Required: {active_crop.get('phosphorus_min', 'N/A')} - {active_crop.get('phosphorus_optimal', 'N/A')} mg/kg
- Potassium Required: {active_crop.get('potassium_min', 'N/A')} - {active_crop.get('potassium_optimal', 'N/A')} mg/kg
"""
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
        all_crops_context = f"""
ALL AVAILABLE CROPS IN CROPIZIDE PLATFORM:
{crops_list}
"""
    else:
        all_crops_context = "\nNo crop database available.\n"

    # ── Live Sensor Data ──────────────────────────────────────
    if sensor_data:
        sensor_context = f"""
LIVE SENSOR READINGS (from user's field right now):
- Air Temperature: {sensor_data.get('air_temperature', sensor_data.get('temperature', 'N/A'))} °C
- Humidity: {sensor_data.get('humidity', 'N/A')} %
- Soil Moisture: {sensor_data.get('soil_moisture_percentage', sensor_data.get('soil_moisture', 'N/A'))} %
- Soil Temperature: {sensor_data.get('soil_temperature', sensor_data.get('soilTemperature', 'N/A'))} °C
- Atmospheric Pressure: {sensor_data.get('pressure', sensor_data.get('atm_pressure', 'N/A'))} hPa
- Nitrogen (N): {sensor_data.get('nitrogen', sensor_data.get('N', 'N/A'))} mg/kg
- Phosphorus (P): {sensor_data.get('phosphorus', sensor_data.get('P', 'N/A'))} mg/kg
- Potassium (K): {sensor_data.get('potassium', sensor_data.get('K', 'N/A'))} mg/kg
"""
    else:
        sensor_context = "\nNo live sensor data available.\n"

   # ── Weather Data ──────────────────────────────────────────────
if weather_data:
    historical = weather_data.get('historical') or {}
    forecast   = weather_data.get('forecast')   or {}

    def parse_entries(data, label):
        lines = []
        try:
            if isinstance(data, dict):
                for key, val in list(data.items())[:5]:
                    if isinstance(val, dict):
                        lines.append(
                            f"- {key}: "
                            f"Temp {val.get('temperature', val.get('temp', val.get('max_temp', 'N/A')))}°C, "
                            f"Humidity {val.get('humidity', 'N/A')}%, "
                            f"Condition: {val.get('condition', val.get('description', val.get('weather', 'N/A')))}, "
                            f"Rain: {val.get('rain', val.get('rainfall', val.get('precipitation', 'N/A')))} mm"
                        )
                    else:
                        lines.append(f"- {key}: {val}")
            elif isinstance(data, list):
                for item in data[:5]:
                    if isinstance(item, dict):
                        lines.append(
                            f"- {item.get('date','N/A')}: "
                            f"Temp {item.get('temperature', item.get('temp','N/A'))}°C, "
                            f"Humidity {item.get('humidity','N/A')}%, "
                            f"Condition: {item.get('condition', item.get('description','N/A'))}"
                        )
        except Exception:
            lines = [f"{label} data could not be parsed"]
        return lines

    hist_lines = parse_entries(historical, "Historical")
    fore_lines = parse_entries(forecast,   "Forecast")

    weather_context = f"""
WEATHER DATA:
Past Weather:
{chr(10).join(hist_lines) if hist_lines else '- No historical data'}

Weather Forecast:
{chr(10).join(fore_lines) if fore_lines else '- No forecast data'}
"""
else:
    weather_context = "\nNo weather data available.\n"
    
    # ── Full Prompt ───────────────────────────────────────────
    return f"""You are ARIA — the intelligent farming assistant for Cropizide, a smart agriculture platform.

You are an expert in:
- Crop cultivation, farming techniques, and best practices
- Soil health, fertilizers, irrigation, and pest management
- Interpreting sensor data (temperature, humidity, soil moisture, NPK levels, pressure)
- Giving specific advice based on real-time field conditions and weather
- Kerala farming, Indian agriculture, and tropical crops

{crop_context}
{all_crops_context}
{sensor_context}
{weather_context}

INSTRUCTIONS:
1. ALWAYS detect the language the user writes or speaks in.
2. ALWAYS reply in the EXACT same language the user used (Malayalam or English or any other).
3. When sensor data is available, USE the actual numbers to give specific advice.
4. When active crop info is available, tailor answers specifically for that crop.
5. When asked about any crop from the platform, use the ALL AVAILABLE CROPS data to answer.
6. When asked about weather, use the WEATHER DATA to give accurate answers.
7. If sensor values are abnormal (low soil moisture, wrong NPK), WARN the farmer and suggest fixes.
8. Compare sensor readings against the active crop's requirements and flag any deficits.
9. Keep responses concise and clear — under 150 words. Use bullet points.
10. Always prioritize the farmer's crop health and yield.

Examples of specific advice:
- If soil moisture is low → suggest irrigation immediately
- If NPK is below crop requirement → recommend specific fertilizer (Urea for N, DAP for P, MOP for K)
- If temperature is too high → suggest mulching or shade nets
- If rain is forecast → advise on irrigation and fertilizer timing
"""


# ── Models ─────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    session_id:   str
    message:      str
    active_crop:  Optional[dict] = None
    sensor_data:  Optional[dict] = None
    all_crops:    Optional[list] = None
    weather_data: Optional[dict] = None


class TTSRequest(BaseModel):
    text: str


# ── Session ────────────────────────────────────────────────────
@app.get("/session")
def create_session():
    sid = str(uuid.uuid4())
    sessions[sid] = { "history": [] }
    return {"session_id": sid}


# ── Chat ───────────────────────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    sid = req.session_id
    if sid not in sessions:
        sessions[sid] = { "history": [] }

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

        sessions[sid]["history"].append({"role": "user",      "content": req.message})
        sessions[sid]["history"].append({"role": "assistant", "content": reply})

        return {"reply": reply, "session_id": sid, "status": "ok"}

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
    if re.search(r'[\u0D00-\u0D7F]', text): return 'ml'
    if re.search(r'[\u0900-\u097F]', text): return 'hi'
    if re.search(r'[\u0B80-\u0BFF]', text): return 'ta'
    if re.search(r'[\u0C00-\u0C7F]', text): return 'te'
    return 'en'


# ── Text to Speech ─────────────────────────────────────────────
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


# ── Health / Ping ──────────────────────────────────────────────
@app.get("/health")
@app.get("/ping")
def health():
    return {"status": "healthy"}
