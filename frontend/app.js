/* ─────────────────────────────────────────────────────────────
   ARIA — Multilingual Voice Chatbot Frontend
   ───────────────────────────────────────────────────────────── */

const API_BASE = "https://https-github-com-eldarosypinheiro-aria.onrender.com"; // Change to your deployed URL when hosting

// ── Firebase Config (from your Cropizide app) ─────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD9Zt3RyCokRdj3qYgex9PCxniYualPcJ0",
  databaseURL: "https://sensor-datas-c8ff3-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// ── State ──────────────────────────────────────────────────────
let sessionId    = null;
let isListening  = false;
let recognition  = null;
let activeCrop   = null;
let sensorData   = null;
let database     = null;

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

// ── Init ───────────────────────────────────────────────────────
async function init() {
  setupSpeechRecognition();
  initFirebase();
  loadActiveCrop();
  await createSession();
  showWelcome();
}

// ── Firebase Init ──────────────────────────────────────────────
function initFirebase() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    database = firebase.database();
    fetchSensorData();
    // Live updates every time sensor data changes
    database.ref('/sensor/history').orderByKey().limitToLast(1).on('value', (snap) => {
      const data = snap.val();
      if (data) {
        const key = Object.keys(data)[0];
        sensorData = data[key];
        updateSensorUI(sensorData);
        document.getElementById("sensorStatus").textContent = "✅ Live — updated just now";
      }
    });
  } catch (e) {
    console.error("Firebase error:", e);
    document.getElementById("sensorStatus").textContent = "⚠️ Could not connect to Firebase";
  }
}

async function fetchSensorData() {
  try {
    const snap = await database.ref('/sensor/history').orderByKey().limitToLast(1).once('value');
    const data = snap.val();
    if (data) {
      const key = Object.keys(data)[0];
      sensorData = data[key];
      updateSensorUI(sensorData);
      document.getElementById("sensorStatus").textContent = "✅ Live sensor connected";
    } else {
      document.getElementById("sensorStatus").textContent = "⚠️ No sensor data found";
    }
  } catch (e) {
    console.error("Sensor fetch error:", e);
    document.getElementById("sensorStatus").textContent = "⚠️ Firebase connection failed";
  }
}

function updateSensorUI(data) {
  if (!data) return;
  const set = (id, key1, key2, unit) => {
    const el = document.querySelector(`#${id} span`);
    if (el) {
      const val = data[key1] !== undefined ? data[key1] : (data[key2] !== undefined ? data[key2] : null);
      el.textContent = val !== null ? `${val}${unit}` : "--";
      // Color warnings
      el.style.color = getWarningColor(key1, val);
    }
  };
  set("s-temp",     "temperature",    "temp",         " °C");
  set("s-hum",      "humidity",       "hum",          " %");
  set("s-soil",     "soilMoisture",   "soil_moisture"," %");
  set("s-soiltemp", "soilTemperature","soil_temp",    " °C");
  set("s-ph",       "ph",             "pH",           "");
  set("s-pressure", "pressure",       "pressure",     " hPa");
  set("s-n",        "nitrogen",       "N",            " mg/kg");
  set("s-p",        "phosphorus",     "P",            " mg/kg");
  set("s-k",        "potassium",      "K",            " mg/kg");
}

function getWarningColor(key, val) {
  if (val === null || val === undefined) return "";
  const warnings = {
    temperature:    { min: 10,  max: 40  },
    humidity:       { min: 30,  max: 90  },
    soilMoisture:   { min: 20,  max: 80  },
    soilTemperature:{ min: 10,  max: 35  },
    ph:             { min: 5.5, max: 7.5 },
    nitrogen:       { min: 10,  max: 280 },
    phosphorus:     { min: 5,   max: 200 },
    potassium:      { min: 10,  max: 300 },
  };
  const range = warnings[key];
  if (!range) return "#e8edf5";
  if (val < range.min || val > range.max) return "#f87171"; // red = warning
  return "#4ade80"; // green = normal
}

// ── Load Active Crop from localStorage ────────────────────────
function loadActiveCrop() {
  try {
    activeCrop = JSON.parse(localStorage.getItem('activeCrop') || 'null');
    updateCropUI();
  } catch (e) {
    activeCrop = null;
  }
}

function updateCropUI() {
  const cropInfo = document.getElementById("cropInfo");
  if (activeCrop) {
    cropInfo.className = "context-info active";
    cropInfo.innerHTML = `
      <div class="crop-name">🌱 ${activeCrop.name || 'Unknown Crop'}</div>
      ${activeCrop.stage ? `<div class="crop-detail">Stage: ${activeCrop.stage}</div>` : ''}
      ${activeCrop.type  ? `<div class="crop-detail">Type: ${activeCrop.type}</div>`   : ''}
    `;
  } else {
    cropInfo.className = "context-info none";
    cropInfo.textContent = "No active crop selected";
  }
}

// ── Session ────────────────────────────────────────────────────
async function createSession() {
  try {
    const res = await fetch(`${API_BASE}/session`);
    const data = await res.json();
    sessionId = data.session_id;
    setStatus("online", "ARIA is online");
    setAriaStatus("Ready to assist");
  } catch (e) {
    setStatus("error", "Can't connect to backend");
    setAriaStatus("Backend offline");
    console.error("Session error:", e);
  }
}

// ── Welcome Screen ─────────────────────────────────────────────
function showWelcome() {
  const cropName = activeCrop ? activeCrop.name : null;

  const enPrompts = cropName ? [
    `How is my ${cropName} doing based on sensor data?`,
    `What fertilizer should I use for ${cropName}?`,
    `Is the soil moisture good for ${cropName}?`,
  ] : [
    "What crops grow well in this weather?",
    "How do I improve soil health?",
    "What does my sensor data indicate?",
  ];

  const mlPrompts = cropName ? [
    `എന്റെ ${cropName} ഇപ്പോൾ എങ്ങനെ ഉണ്ട്?`,
    `${cropName}ന് ഏത് വളം ഉപയോഗിക്കണം?`,
  ] : [
    "മണ്ണ് എങ്ങനെ മെച്ചപ്പെടുത്താം?",
    "ഏത് വിള കൃഷി ചെയ്യണം?",
  ];

  const allPrompts = [...enPrompts.slice(0,2), ...mlPrompts.slice(0,2)];

  const el = document.createElement("div");
  el.className = "welcome-msg";
  el.innerHTML = `
    <span class="big-icon">🌾</span>
    <h2>Hello, I'm ARIA</h2>
    <p>Your smart Cropizide farming assistant.<br>
    I read your <strong>live sensor data</strong> and give crop-specific advice in your language.</p>
    <div class="quick-prompts">
      ${allPrompts.map(p => `<button class="quick-btn" data-prompt="${p.replace(/"/g,'&quot;')}">${p}</button>`).join("")}
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

  const welcome = chatBox.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  appendMessage("user", text);
  userInput.value = "";
  autoResizeTextarea();

  const typingId = appendTyping();
  setAriaStatus("Thinking...");

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id:  sessionId,
        message:     text,
        active_crop: activeCrop,   // ← Send crop data
        sensor_data: sensorData    // ← Send live sensor data
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
  } catch (e) {
    removeTyping(typingId);
    appendMessage("bot", "⚠️ Could not reach the server. Make sure your backend is running.");
    setAriaStatus("Connection error");
  }
}

// ── Append Message ─────────────────────────────────────────────
function appendMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg-wrap ${role}`;

  const avatar = role === "bot" ? "🌱" : "👤";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const speakBtn = role === "bot"
    ? `<button class="speak-btn" title="Replay audio" onclick="speakText(this.closest('.msg-content').querySelector('.msg-bubble').innerText)">🔊</button>`
    : "";

  wrap.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-content">
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-meta">
        <span class="msg-time">${time}</span>
        ${speakBtn}
      </div>
    </div>
  `;

  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ── Typing Indicator ───────────────────────────────────────────
function appendTyping() {
  const id = "typing-" + Date.now();
  const wrap = document.createElement("div");
  wrap.className = "msg-wrap bot";
  wrap.id = id;
  wrap.innerHTML = `
    <div class="msg-avatar">🌱</div>
    <div class="msg-content">
      <div class="msg-bubble typing-bubble">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ── Text-to-Speech via Backend gTTS ───────────────────────────
async function speakText(text) {
  if (!text) return;

  if (window._currentAudio) {
    window._currentAudio.pause();
    window._currentAudio = null;
  }

  setAriaStatus("Speaking…");

  try {
    const response = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text })
    });

    const blob = await response.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    window._currentAudio = audio;
    audio.onended = () => setAriaStatus("Ready to assist");
    audio.onerror = () => setAriaStatus("Ready to assist");
    audio.play();

  } catch (e) {
    console.error("TTS failed, using browser fallback:", e);
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
    setAriaStatus("Ready to assist");
  }
}

// ── Speech Recognition ─────────────────────────────────────────
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = "Voice input not supported. Use Chrome.";
    micBtn.style.opacity = "0.4";
    return;
  }

  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("active");
    micBtn.textContent = "🔴";
    waveform.classList.remove("hidden");
    const langName = langSelect.options[langSelect.selectedIndex].text;
    setAriaStatus(`Listening in ${langName}…`);
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    userInput.value = transcript;
    sendMessage(transcript);
  };

  recognition.onerror = (e) => {
    console.error("Speech error:", e.error);
    stopListening();
    if (e.error === "not-allowed") {
      appendMessage("bot", "⚠️ Microphone access denied. Please allow mic permissions and try again.");
    }
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

// ── Clear Conversation ─────────────────────────────────────────
async function clearConversation() {
  if (sessionId) {
    try { await fetch(`${API_BASE}/session/${sessionId}`, { method: "DELETE" }); } catch {}
  }
  chatBox.innerHTML = "";
  if (window._currentAudio) { window._currentAudio.pause(); window._currentAudio = null; }
  window.speechSynthesis && window.speechSynthesis.cancel();
  await createSession();
  showWelcome();
}

// ── Helpers ────────────────────────────────────────────────────
function setStatus(type, msg) {
  statusDot.className = `status-dot ${type}`;
  connStatus.textContent = msg;
}

function setAriaStatus(msg) {
  ariaStatus.textContent = msg;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

function autoResizeTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}

// ── Event Listeners ────────────────────────────────────────────
sendBtn.addEventListener("click", () => sendMessage());

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

userInput.addEventListener("input", autoResizeTextarea);

micBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    recognition.lang = langSelect.value;
    recognition.start();
  }
});

clearBtn.addEventListener("click", clearConversation);

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
  sidebar.classList.toggle("open");
});

// ── Start ──────────────────────────────────────────────────────
init();