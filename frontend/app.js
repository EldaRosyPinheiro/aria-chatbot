/* ─────────────────────────────────────────────────────────────
   ARIA — app.js with full Cropizide data context
   Loads: active crop, all crops, live sensors, weather
   ───────────────────────────────────────────────────────────── */

const API_BASE = "https://https-github-com-eldarosypinheiro-aria.onrender.com";

// ── Firebase Configs ───────────────────────────────────────────

// Sensor RTDB — live sensor readings
const FIREBASE_MAIN_CONFIG = {
  apiKey:      "AIzaSyD9Zt3RyCokRdj3qYgex9PCxniYualPcJ0",
  projectId:   "sensor-datas-c8ff3",
  databaseURL: "https://sensor-datas-c8ff3-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Cropizide main app — user data, activeCrop, Firestore crops
const FIREBASE_CROPIZIDE_CONFIG = {
  apiKey:            "AIzaSyC7SQKJgXcE4glap7K4L6XTO6o3AwN3Yik",
  authDomain:        "cropizide-53cc5.firebaseapp.com",
  projectId:         "cropizide-53cc5",
  storageBucket:     "cropizide-53cc5.firebasestorage.app",
  messagingSenderId: "914171803917",
  appId:             "1:914171803917:web:22f82fa7c0cf742d705844",
  databaseURL:       "https://cropizide-53cc5-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Weather RTDB
const FIREBASE_WEATHER_CONFIG = {
  apiKey:      "AIzaSyDIZlgvJk7dIyuzIQWuHKusv5ZcBbvHi_8",
  authDomain:  "weatherdatas.firebaseapp.com",
  projectId:   "weatherdatas",
  databaseURL: "https://weatherdatas-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// ── State ──────────────────────────────────────────────────────
let sessionId    = null;
let isListening  = false;
let recognition  = null;
let activeCrop   = null;
let sensorData   = null;
let allCrops     = [];
let weatherData  = null;
let mainDb       = null;
let cropizideDb  = null;
let weatherDb    = null;

// ── DOM Refs ───────────────────────────────────────────────────
const chatBox       = document.getElementById("chat-box");
const userInput     = document.getElementById("user-input");
const micBtn        = document.getElementById("mic-btn");
const sendBtn       = document.getElementById("send-btn");
const clearBtn      = document.getElementById("clear-btn");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebar       = document.getElementById("sidebar");
const waveform      = document.getElementById("waveform");
const ariaStatus    = document.getElementById("aria-status");
const connStatus    = document.getElementById("conn-status");
const statusDot     = document.getElementById("status-dot");
const langSelect    = document.getElementById("lang-select");

// ── Go Back ────────────────────────────────────────────────────
function goBack() {
  if (document.referrer) window.history.back();
  else window.location.href = "/chatbot";
}

// ── Phone key normalizer (matches Cropizide's phoneToKey) ──────
function phoneToKey(phone) {
  return phone.replace(/[^+0-9]/g, "");
}

// ── Init ───────────────────────────────────────────────────────
async function init() {
  loadUserFromURL();
  setupSpeechRecognition();
  initFirebase();
  await waitForCropizideDb();
  await loadActiveCrop();
  await createSession();
  showWelcome();
}

// ── Wait for cropizideDb to be ready ──────────────────────────
function waitForCropizideDb() {
  return new Promise((resolve) => {
    if (cropizideDb) { resolve(); return; }
    const check = setInterval(() => {
      if (cropizideDb) { clearInterval(check); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 5000);
  });
}

// ── Read user param from URL ───────────────────────────────────
function loadUserFromURL() {
  const params = new URLSearchParams(window.location.search);
  const user   = params.get("user");
  if (user) localStorage.setItem("currentUserPhone", user);
}

// ── Load Active Crop from Cropizide RTDB ──────────────────────
async function loadActiveCrop() {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawPhone = params.get("user") || localStorage.getItem("currentUserPhone");

    if (!rawPhone) {
      console.warn("No user phone — cannot load active crop");
      updateCropUI();
      return;
    }

    const phone = phoneToKey(rawPhone);
    console.log("Loading activeCrop for phone:", phone);
    console.log("Firebase path: users/" + phone + "/activeCrop");

    const snap = await cropizideDb.ref(`users/${phone}/activeCrop`).once("value");
    console.log("activeCrop snap exists:", snap.exists());
    console.log("activeCrop value:", snap.val());

    activeCrop = snap.val();
    updateCropUI();
  } catch(e) {
    console.error("Active crop load error:", e);
    activeCrop = null;
    updateCropUI();
  }
}

function updateCropUI() {
  const cropInfo = document.getElementById("cropInfo");
  if (!cropInfo) return;

  if (activeCrop) {
    cropInfo.className = "context-info active";
    cropInfo.innerHTML = `
      <div class="crop-name">🌱 ${activeCrop.name || "Unknown Crop"}</div>
      ${activeCrop.growthDuration ? `<div class="crop-detail">Growth: ${activeCrop.growthDuration} days</div>` : ""}
      ${activeCrop.activatedDate  ? `<div class="crop-detail">Started: ${new Date(activeCrop.activatedDate).toLocaleDateString()}</div>` : ""}
      ${activeCrop.temperature    ? `<div class="crop-detail">Temp: ${activeCrop.temperature}</div>` : ""}
      ${activeCrop.humidity       ? `<div class="crop-detail">Humidity: ${activeCrop.humidity}</div>` : ""}
      ${activeCrop.nitrogen_min   ? `<div class="crop-detail">N: ${activeCrop.nitrogen_min}-${activeCrop.nitrogen_optimal || '?'} mg/kg</div>` : ""}
      ${activeCrop.phosphorus_min ? `<div class="crop-detail">P: ${activeCrop.phosphorus_min}-${activeCrop.phosphorus_optimal || '?'} mg/kg</div>` : ""}
      ${activeCrop.potassium_min  ? `<div class="crop-detail">K: ${activeCrop.potassium_min}-${activeCrop.potassium_optimal || '?'} mg/kg</div>` : ""}
    `;
  } else {
    cropInfo.className = "context-info none";
    cropInfo.textContent = "No active crop selected";
  }
}

// ── Firebase Init ──────────────────────────────────────────────
function initFirebase() {
  try {
    // Sensor RTDB
    const mainApp = firebase.apps.find(a => a.name === "main")
      || firebase.initializeApp(FIREBASE_MAIN_CONFIG, "main");
    mainDb = firebase.database(mainApp);

    // Cropizide main app (user data + activeCrop + Firestore)
    const cropizideApp = firebase.apps.find(a => a.name === "cropizide")
      || firebase.initializeApp(FIREBASE_CROPIZIDE_CONFIG, "cropizide");
    cropizideDb = firebase.database(cropizideApp);

    // Firestore for crops
    const firestore = (typeof firebase.firestore === "function")
      ? firebase.firestore(cropizideApp)
      : null;

    // Weather RTDB
    const weatherApp = firebase.apps.find(a => a.name === "weather")
      || firebase.initializeApp(FIREBASE_WEATHER_CONFIG, "weather");
    weatherDb = firebase.database(weatherApp);

    // ── Live sensor listener ───────────────────────────────────
    mainDb.ref("/sensor/history").orderByKey().limitToLast(1).on("value", (snap) => {
      const data = snap.val();
      if (data) {
        const key  = Object.keys(data)[0];
        sensorData = data[key];
        updateSensorUI(sensorData);
        const el = document.getElementById("sensorStatus");
        if (el) el.textContent = "✅ Live — updated just now";
      } else {
        const el = document.getElementById("sensorStatus");
        if (el) el.textContent = "⚠️ No sensor data found";
      }
    });

    // ── Weather listener ───────────────────────────────────────
    weatherDb.ref("/weather/data").once("value", (snap) => {
      const historical = snap.val();
      weatherDb.ref("/weather/forecast").once("value", (snap2) => {
        const forecast = snap2.val();
        weatherData = { historical, forecast };
        console.log("✅ Weather loaded — historical:", !!historical, "forecast:", !!forecast);
      });
    });

    // ── Load all crops from Firestore ──────────────────────────
    if (firestore) {
      loadAllCrops(firestore);
    } else {
      console.warn("Firestore not available");
    }

  } catch(e) {
    console.error("Firebase error:", e);
    const el = document.getElementById("sensorStatus");
    if (el) el.textContent = "⚠️ Firebase connection failed";
  }
}

// ── Load all crops from Firestore ──────────────────────────────
async function loadAllCrops(firestore) {
  try {
    const snap = await firestore.collection("crops").get();
    allCrops = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`✅ Loaded ${allCrops.length} crops from Firestore`);
  } catch(e) {
    console.error("Firestore crops error:", e);
    allCrops = [];
  }
}

// ── Sensor UI ──────────────────────────────────────────────────
function updateSensorUI(data) {
  if (!data) return;
  const set = (id, key1, key2, unit) => {
    const el  = document.querySelector(`#${id} span`);
    if (!el) return;
    const val = data[key1] !== undefined ? data[key1]
              : data[key2] !== undefined ? data[key2] : null;
    el.textContent = val !== null ? `${val}${unit}` : "--";
    el.style.color = val !== null ? getWarningColor(key1, val) : "rgba(255,255,255,0.4)";
  };

  set("s-temp",     "air_temperature",          "temperature",     " °C");
  set("s-hum",      "humidity",                 "hum",             " %");
  set("s-soil",     "soil_moisture_percentage", "soil_moisture",   " %");
  set("s-soiltemp", "soil_temperature",          "soilTemperature", " °C");
  set("s-pressure", "pressure",                 "atm_pressure",    " hPa");
  set("s-n",        "nitrogen",                 "N",               " mg/kg");
  set("s-p",        "phosphorus",               "P",               " mg/kg");
  set("s-k",        "potassium",                "K",               " mg/kg");
}

function getWarningColor(key, val) {
  const ranges = {
    air_temperature:          { min: 10,  max: 40  },
    humidity:                 { min: 30,  max: 90  },
    soil_moisture_percentage: { min: 20,  max: 80  },
    soil_temperature:         { min: 10,  max: 35  },
    nitrogen:                 { min: 10,  max: 280 },
    phosphorus:               { min: 5,   max: 200 },
    potassium:                { min: 10,  max: 300 },
  };
  const range = ranges[key];
  if (!range) return "rgba(255,255,255,0.9)";
  return (val < range.min || val > range.max) ? "#f87171" : "#4ade80";
}

// ── Session ────────────────────────────────────────────────────
async function createSession() {
  try {
    const res  = await fetch(`${API_BASE}/session`);
    const data = await res.json();
    sessionId  = data.session_id;
    setStatus("online", "ARIA is online");
    setAriaStatus("Ready to assist");
  } catch(e) {
    setStatus("error", "Can't connect to backend");
    setAriaStatus("Backend offline");
  }
}

// ── Welcome ────────────────────────────────────────────────────
function showWelcome() {
  const cropName = activeCrop?.name || null;
  const enPrompts = cropName ? [
    `How is my ${cropName} doing based on sensor data?`,
    `What fertilizer does ${cropName} need right now?`,
  ] : [
    "What does my sensor data indicate?",
    "What crops grow well in this weather?",
  ];
  const mlPrompts = cropName ? [
    `എന്റെ ${cropName} ഇപ്പോൾ എങ്ങനെ ഉണ്ട്?`,
    `${cropName}ന് ഏത് വളം ഉപയോഗിക്കണം?`,
  ] : [
    "മണ്ണ് എങ്ങനെ മെച്ചപ്പെടുത്താം?",
    "ഇന്നത്തെ കാലാവസ്ഥ കൃഷിക്ക് അനുയോജ്യമാണോ?",
  ];

  const el = document.createElement("div");
  el.className = "welcome-msg";
  el.innerHTML = `
    <span class="big-icon">🌾</span>
    <h2>Hello, I'm ARIA</h2>
    <p>Your smart Cropizide farming assistant.<br>
    I know your <strong>live sensor data</strong>, <strong>all crops</strong>, and <strong>weather forecast</strong>.</p>
    <div class="quick-prompts">
      ${[...enPrompts, ...mlPrompts].map(p =>
        `<button class="quick-btn" data-prompt="${p.replace(/"/g,"&quot;")}">${p}</button>`
      ).join("")}
    </div>
  `;
  chatBox.appendChild(el);
  el.querySelectorAll(".quick-btn").forEach(btn => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.prompt));
  });
}

// ── Send Message ───────────────────────────────────────────────
async function sendMessage(text) {
  text = text || userInput.value.trim();
  if (!text || !sessionId) return;

  chatBox.querySelector(".welcome-msg")?.remove();
  appendMessage("user", text);
  userInput.value = "";
  autoResizeTextarea();

  const typingId = appendTyping();
  setAriaStatus("Thinking...");

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id:   sessionId,
        message:      text,
        active_crop:  activeCrop,
        sensor_data:  sensorData,
        all_crops:    allCrops,
        weather_data: weatherData
      }),
    });

    const data = await res.json();
    removeTyping(typingId);

    if (data.status === "ok") {
      appendMessage("bot", data.reply);
      speakText(data.reply);
      setAriaStatus("Ready to assist");
    } else {
      appendMessage("bot", `⚠️ ${data.reply}`);
      setAriaStatus("Error occurred");
    }
  } catch(e) {
    removeTyping(typingId);
    appendMessage("bot", "⚠️ Could not reach the server.");
    setAriaStatus("Connection error");
  }
}

// ── Append Message ─────────────────────────────────────────────
function appendMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg-wrap ${role}`;
  const avatar   = role === "bot" ? "🌱" : "👤";
  const time     = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const speakBtn = role === "bot"
    ? `<button class="speak-btn" onclick="speakText(this.closest('.msg-content').querySelector('.msg-bubble').innerText)">🔊</button>`
    : "";

  wrap.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-content">
      <div class="msg-bubble">${formatText(text)}</div>
      <div class="msg-meta">
        <span class="msg-time">${time}</span>
        ${speakBtn}
      </div>
    </div>
  `;
  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function formatText(text) {
  return text
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*(.*?)\*/g,"<em>$1</em>")
    .replace(/\n/g,"<br>");
}

function appendTyping() {
  const id   = "typing-" + Date.now();
  const wrap = document.createElement("div");
  wrap.className = "msg-wrap bot"; wrap.id = id;
  wrap.innerHTML = `
    <div class="msg-avatar">🌱</div>
    <div class="msg-content">
      <div class="msg-bubble typing-bubble">
        <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
      </div>
    </div>`;
  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
  return id;
}

function removeTyping(id) { document.getElementById(id)?.remove(); }

// ── TTS ────────────────────────────────────────────────────────
async function speakText(text) {
  if (!text) return;
  if (window._currentAudio) { window._currentAudio.pause(); window._currentAudio = null; }
  setAriaStatus("Speaking…");
  try {
    const res   = await fetch(`${API_BASE}/tts`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text })
    });
    const blob  = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    window._currentAudio = audio;
    audio.onended = () => setAriaStatus("Ready to assist");
    audio.onerror = () => setAriaStatus("Ready to assist");
    audio.play();
  } catch(e) {
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
    setAriaStatus("Ready to assist");
  }
}

// ── Speech Recognition ─────────────────────────────────────────
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { micBtn.disabled = true; micBtn.style.opacity = "0.4"; return; }

  recognition = new SR();
  recognition.continuous     = false;
  recognition.interimResults = false;

  recognition.onstart  = () => {
    isListening = true;
    micBtn.classList.add("active");
    micBtn.textContent = "🔴";
    waveform.classList.remove("hidden");
    setAriaStatus(`Listening in ${langSelect.options[langSelect.selectedIndex].text}…`);
  };
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    userInput.value  = transcript;
    sendMessage(transcript);
  };
  recognition.onerror  = (e) => {
    stopListening();
    if (e.error === "not-allowed")
      appendMessage("bot", "⚠️ Microphone access denied.");
  };
  recognition.onend = stopListening;
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove("active");
  micBtn.textContent = "🎤";
  waveform.classList.add("hidden");
  setAriaStatus("Ready to assist");
}

// ── Clear ──────────────────────────────────────────────────────
async function clearConversation() {
  if (sessionId) {
    try { await fetch(`${API_BASE}/session/${sessionId}`, { method: "DELETE" }); } catch {}
  }
  chatBox.innerHTML = "";
  if (window._currentAudio) { window._currentAudio.pause(); window._currentAudio = null; }
  window.speechSynthesis?.cancel();
  await createSession();
  showWelcome();
}

// ── Helpers ────────────────────────────────────────────────────
function setStatus(type, msg) { statusDot.className = `status-dot ${type}`; connStatus.textContent = msg; }
function setAriaStatus(msg)   { if (ariaStatus) ariaStatus.textContent = msg; }
function autoResizeTextarea() { userInput.style.height = "auto"; userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px"; }

// ── Events ─────────────────────────────────────────────────────
sendBtn.addEventListener("click",   () => sendMessage());
clearBtn.addEventListener("click",  clearConversation);
userInput.addEventListener("input", autoResizeTextarea);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
micBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (isListening) recognition.stop();
  else { recognition.lang = langSelect.value; recognition.start(); }
});

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("hidden");
    sidebar.classList.toggle("open");
  });
}

// ── Start ──────────────────────────────────────────────────────
init();
