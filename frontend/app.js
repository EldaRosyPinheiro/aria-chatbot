/* ─────────────────────────────────────────────────────────────
   ARIA — Multilingual Voice Chatbot Frontend
   ───────────────────────────────────────────────────────────── */

const API_BASE = "http://localhost:8000"; // Change to your deployed URL when hosting

// ── State ──────────────────────────────────────────────────────
let sessionId = null;
let isListening = false;
let recognition = null;

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

// ── Init ───────────────────────────────────────────────────────
async function init() {
  setupSpeechRecognition();
  await createSession();
  showWelcome();
}

// ── Session ────────────────────────────────────────────────────
async function createSession() {
  try {
    const res = await fetch(`${API_BASE}/session`);
    const data = await res.json();
    sessionId = data.session_id;
    setStatus("online", "ARIA is online");
  } catch (e) {
    setStatus("error", "Can't connect to backend");
    console.error("Session error:", e);
  }
}

// ── Welcome Screen ─────────────────────────────────────────────
function showWelcome() {
  const prompts = [
    "Hello! Who are you?",
    "നമസ്കാരം! നിങ്ങൾ മലയാളം സംസാരിക്കുമോ?",
    "Translate 'Good morning' to French",
    "¿Hablas español?",
  ];

  const el = document.createElement("div");
  el.className = "welcome-msg";
  el.innerHTML = `
    <span class="big-icon">◈</span>
    <h2>Hello, I'm ARIA</h2>
    <p>Your multilingual AI assistant. I speak your language — just type or say something.</p>
    <div class="quick-prompts">
      ${prompts.map(p => `<button class="quick-btn" data-prompt="${p}">${p}</button>`).join("")}
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

  // Clear welcome
  const welcome = chatBox.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  appendMessage("user", text);
  userInput.value = "";
  autoResizeTextarea();

  // Typing indicator
  const typingId = appendTyping();
  setAriaStatus("Thinking…");

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text }),
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

  const avatar = role === "bot" ? "◈" : "👤";
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
    <div class="msg-avatar">◈</div>
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

  // Stop any current audio
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
    // Fallback to browser TTS
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
    setAriaStatus("Ready to assist");
  }
}

// ── Speech Recognition (Voice Input) ──────────────────────────
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = "Voice input not supported in this browser. Use Chrome.";
    micBtn.style.opacity = "0.4";
    return;
  }

  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = ""; // auto-detect language

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("active");
    micBtn.textContent = "🔴";
    waveform.classList.remove("hidden");
    setAriaStatus("Listening…");
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
      appendMessage("bot", "⚠️ Microphone access denied. Please allow mic permissions in your browser and try again.");
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