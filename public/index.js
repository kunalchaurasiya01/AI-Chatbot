// Test mode helper to bypass native confirm dialogs during automated verification
if (window.location.search.includes("test=true")) {
  window.confirm = () => true;
}

// Session variables
const sessionId = "session-" + Math.random().toString(36).slice(2);
let currentUser = null;
let currentChatId = null;
let chatsList = [];

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("userInput");
const dragOverlay = document.getElementById("dragOverlay");
const dropZone = document.getElementById("dropZone");
const fileDetails = document.getElementById("fileDetails");
const fileNameEl = document.getElementById("fileName");
const webSearchToggle = document.getElementById("webSearchToggle");
const voiceOutputToggle = document.getElementById("voiceOutputToggle");
const voiceSelect = document.getElementById("voiceSelect");

let recognition = null;
let isListening = false;
let synth = window.speechSynthesis;
let voices = [];

// Initialize Speech Recognition (STT)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    document.getElementById("micBtn").classList.add("listening");
  };

  recognition.onend = () => {
    isListening = false;
    document.getElementById("micBtn").classList.remove("listening");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    inputEl.value = (inputEl.value + " " + transcript).trim();
    adjustTextareaHeight();
  };

  recognition.onerror = (e) => {
    console.error("Speech recognition error:", e.error);
    isListening = false;
    document.getElementById("micBtn").classList.remove("listening");
  };
} else {
  document.getElementById("micBtn").style.display = "none";
  console.warn("Web Speech API recognition is not supported in this browser.");
}

// Populate Speech Synthesis Voices (TTS)
function populateVoiceList() {
  if (!synth) return;
  voices = synth.getVoices();
  voiceSelect.innerHTML = '';

  voices.forEach((voice) => {
    const option = document.createElement('option');
    option.textContent = `${voice.name} (${voice.lang})`;
    option.value = voice.name;

    if (voice.name.includes("Google US English") || voice.name.includes("Microsoft David") || (voice.lang === "en-US" && voice.default)) {
      option.selected = true;
    }
    voiceSelect.appendChild(option);
  });
}

if (synth) {
  populateVoiceList();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = populateVoiceList;
  }
} else {
  document.getElementById("voiceOutputToggle").disabled = true;
  voiceSelect.disabled = true;
  console.warn("Speech synthesis not supported in this browser.");
}

// Adjust input textarea height dynamically
function adjustTextareaHeight() {
  inputEl.style.height = "auto";
  inputEl.style.height = (inputEl.scrollHeight) + "px";
}

// Formatting utility to make markdown look elegant
function formatMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt bridge;"); // Fixing normal escape sequences

  // Restore tags we escaped above
  html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Code blocks
  html = html.replace(/```([\s\S]+?)```/g, "<pre><code>$1</code></pre>");
  // Inline code
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");

  // Paragraphs and lists
  const lines = html.split("\n");
  let inList = false;
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      let content = trimmed.substring(2);
      let listHTML = "";
      if (!inList) {
        listHTML += "<ul>";
        inList = true;
      }
      listHTML += "<li>" + content + "</li>";
      return listHTML;
    } else {
      let listHTML = "";
      if (inList) {
        listHTML += "</ul>";
        inList = false;
      }
      return listHTML + line;
    }
  });
  if (inList) processedLines.push("</ul>");

  return processedLines.join("\n").replace(/\n/g, "<br>");
}

// Render a new chat message bubble
function addMessage(text, sender, grounding = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg-wrapper " + sender;

  const msgDiv = document.createElement("div");
  msgDiv.className = "msg";

  if (sender === "user") {
    msgDiv.textContent = text;
  } else {
    msgDiv.innerHTML = formatMarkdown(text);
  }
  wrapper.appendChild(msgDiv);

  // If grounding (citations) metadata is present, render citation badges
  if (grounding && grounding.groundingChunks && grounding.groundingChunks.length > 0) {
    const gBox = document.createElement("div");
    gBox.className = "grounding-box";

    const gTitle = document.createElement("div");
    gTitle.className = "grounding-title";
    gTitle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Search Grounding Sources`;
    gBox.appendChild(gTitle);

    if (grounding.webSearchQueries && grounding.webSearchQueries.length > 0) {
      const queries = document.createElement("div");
      queries.className = "grounding-queries";
      queries.textContent = `Queries: ${grounding.webSearchQueries.map(q => `"${q}"`).join(", ")}`;
      gBox.appendChild(queries);
    }

    const sourcesList = document.createElement("div");
    sourcesList.className = "sources-list";

    const seenUris = new Set();
    grounding.groundingChunks.forEach((chunk) => {
      if (!chunk.web?.uri) return;
      const uri = chunk.web.uri;
      if (seenUris.has(uri)) return;
      seenUris.add(uri);

      const domain = new URL(uri).hostname.replace("www.", "");
      const title = chunk.web.title || domain;

      const a = document.createElement("a");
      a.className = "source-tag";
      a.href = uri;
      a.target = "_blank";
      a.innerHTML = `🌐 ${title} (${domain})`;
      sourcesList.appendChild(a);
    });

    gBox.appendChild(sourcesList);
    wrapper.appendChild(gBox);
  }

  // Add metadata row with "Listen" button for Assistant replies
  if (sender === "assistant" && !msgDiv.classList.contains("typing")) {
    const metaDiv = document.createElement("div");
    metaDiv.className = "msg-meta";

    const btn = document.createElement("button");
    btn.className = "speak-btn";
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg> Listen`;
    btn.onclick = () => speakMessage(text);
    metaDiv.appendChild(btn);

    wrapper.appendChild(metaDiv);
  }

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrapper;
}

// Trigger voice typing
function toggleVoiceInput() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

// Voice speech synthesis execution
function speakMessage(text) {
  if (!synth) return;
  synth.cancel();

  const cleanText = text
    .replace(/\*\*|__/g, "")
    .replace(/\*|_/g, "")
    .replace(/`+/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/<\/?[^>]+(>|$)/g, "");

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const selectedVoiceName = voiceSelect.value;
  const selectedVoice = voices.find(v => v.name === selectedVoiceName);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  synth.speak(utterance);
}

// Send input message
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  inputEl.value = "";
  adjustTextareaHeight();

  const useWebSearch = webSearchToggle.checked;
  const typingWrapper = addMessage("Thinking...", "assistant typing");

  try {
    let res;
    if (currentUser) {
      // If logged in but no chat active, create one first
      if (!currentChatId) {
        const createRes = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        const chatData = await createRes.json();
        if (!createRes.ok) throw new Error(chatData.error || "Failed to create chat");
        currentChatId = chatData.chatId;
        await loadChats();
      }
      res = await fetch(`/api/chats/${currentChatId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, useWebSearch })
      });
    } else {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, useWebSearch })
      });
    }

    const data = await res.json();
    typingWrapper.remove();

    if (data.error) {
      addMessage(data.error, "assistant");
    } else {
      addMessage(data.reply || "No reply content generated.", "assistant", data.grounding);

      if (voiceOutputToggle.checked) {
        speakMessage(data.reply);
      }

      if (currentUser) {
        await loadChats();
      }
    }
  } catch (err) {
    typingWrapper.remove();
    addMessage("Error reaching the server. Please check your connection.", "assistant");
  }
}

// Trigger file attachment browsing dialog
function triggerFileInput() {
  const fileInputEl = document.getElementById("fileInput");
  if (fileInputEl) fileInputEl.click();
}

// Clear current document from chat session state
async function clearDocument() {
  try {
    let res;
    if (currentUser && currentChatId) {
      res = await fetch(`/api/chats/${currentChatId}/clear-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
    } else {
      res = await fetch("/api/clear-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
    }
    const data = await res.json();

    if (fileDetails) fileDetails.style.display = "none";
    if (dropZone) dropZone.style.display = "flex";
    if (fileNameEl) fileNameEl.textContent = "";

    addMessage("📎 Document contextual references removed from session.", "assistant");
  } catch (err) {
    console.error(err);
    alert("Failed to clear document from session context.");
  }
}

// Parse and upload selected files
async function handleFileSelect(e) {
  const file = (e.target && e.target.files && e.target.files[0])
    || (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  if (!file) return;

  const fileInputEl = document.getElementById("fileInput");
  if (fileInputEl) fileInputEl.value = "";

  if (fileDetails) fileDetails.style.display = "flex";
  if (fileNameEl) fileNameEl.textContent = "Processing " + file.name + "...";
  if (dropZone) dropZone.style.display = "none";

  const formData = new FormData();
  formData.append("file", file);

  try {
    let res;
    if (currentUser) {
      if (!currentChatId) {
        const createRes = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        const chatData = await createRes.json();
        if (!createRes.ok) throw new Error(chatData.error || "Failed to create chat");
        currentChatId = chatData.chatId;
        await loadChats();
      }
      res = await fetch(`/api/chats/${currentChatId}/upload`, {
        method: "POST",
        body: formData
      });
    } else {
      formData.append("sessionId", sessionId);
      res = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
    }
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to upload file");
    }

    fileNameEl.textContent = data.filename;
    addMessage(`📎 Uploaded document **"${data.filename}"** is now active context. You can ask questions about its content!`, "assistant");
  } catch (err) {
    console.error(err);
    alert("Error: " + err.message);
    if (fileDetails) fileDetails.style.display = "none";
    if (dropZone) dropZone.style.display = "flex";
    if (fileNameEl) fileNameEl.textContent = "";
  }
}

// Event handler keydown trigger for textarea
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Drag and drop event logic setup
const chatArea = document.querySelector(".chat-area");

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  dragOverlay.classList.add("active");
});

dragOverlay.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragOverlay.classList.remove("active");
});

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragOverlay.classList.remove("active");
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect({ dataTransfer: e.dataTransfer, target: {} });
  }
});


// ==========================================
// AUTHENTICATION AND CHAT HISTORY LOGIC
// ==========================================

// Check user state on load
async function checkAuth() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (data.loggedIn) {
      currentUser = data.user;
      document.getElementById("newChatBtn").style.display = "block";
      document.getElementById("chatsSection").style.display = "block";
      updateUserProfileUI(true);
      await loadChats();
    } else {
      currentUser = null;
      document.getElementById("newChatBtn").style.display = "none";
      document.getElementById("chatsSection").style.display = "none";
      updateUserProfileUI(false);
      resetChatUI();
    }
  } catch (err) {
    console.error("Error checking auth status:", err);
    updateUserProfileUI(false);
  }
}

// Set user profile footer UI
function updateUserProfileUI(isLoggedIn) {
  const profileEl = document.getElementById("userProfile");
  const headerAuthEl = document.getElementById("headerAuth");

  if (isLoggedIn && currentUser) {
    // Sidebar profile
    profileEl.innerHTML = `
      <div class="user-info">
        <div class="user-avatar">${currentUser.username.substring(0, 2).toUpperCase()}</div>
        <div class="user-details">
          <span class="username">${currentUser.username}</span>
          <span class="user-email">${currentUser.email}</span>
        </div>
      </div>
      <button class="logout-btn" title="Log Out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
      </button>
    `;
    const logoutBtn = profileEl.querySelector(".logout-btn");
    if (logoutBtn) logoutBtn.onclick = () => handleLogout();

    // Header profile
    if (headerAuthEl) {
      headerAuthEl.innerHTML = `
        <div class="user-info-header">
          <div class="user-avatar-header">${currentUser.username.substring(0, 2).toUpperCase()}</div>
          <span class="username-header">${currentUser.username}</span>
          <button class="logout-btn-header" title="Log Out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      `;
      const headerLogoutBtn = headerAuthEl.querySelector(".logout-btn-header");
      if (headerLogoutBtn) headerLogoutBtn.onclick = () => handleLogout();
    }
  } else {
    // Sidebar sign-in
    profileEl.innerHTML = `
      <button class="btn-signin">Sign In / Sign Up</button>
    `;
    const signinBtn = profileEl.querySelector(".btn-signin");
    if (signinBtn) signinBtn.onclick = () => openAuthModal();

    // Header sign-in & sign-up
    if (headerAuthEl) {
      headerAuthEl.innerHTML = `
        <button class="btn-header-login" onclick="openAuthModal('login')">Log In</button>
        <button class="btn-header-signup" onclick="openAuthModal('register')">Sign Up</button>
      `;
    }
  }
}

// Load chats lists for user
async function loadChats() {
  try {
    const res = await fetch("/api/chats");
    chatsList = await res.json();
    renderChatsList();

    // If we don't have an active chat, select first one
    if (!currentChatId && chatsList.length > 0) {
      selectChat(chatsList[0].id);
    } else if (chatsList.length === 0) {
      currentChatId = null;
      resetChatUI();
    }
  } catch (err) {
    console.error("Error loading chats:", err);
  }
}

// Render chat links in sidebar
function renderChatsList() {
  const listContainer = document.getElementById("chatsList");
  const chatsSection = document.getElementById("chatsSection");
  listContainer.innerHTML = "";

  if (chatsList.length === 0) {
    if (chatsSection) chatsSection.style.display = "none";
    return;
  }

  if (chatsSection) chatsSection.style.display = "block";

  const displayChats = chatsList;
  displayChats.forEach(chat => {
    const isActive = chat.id === currentChatId;
    const chatItem = document.createElement("div");
    chatItem.className = `chat-item ${isActive ? 'active' : ''}`;
    chatItem.onclick = () => selectChat(chat.id);

    chatItem.innerHTML = `
      <span class="chat-icon">💬</span>
      <span class="chat-title" id="chat-title-${chat.id}">${chat.title}</span>
      <input type="text" class="chat-rename-input" id="chat-input-${chat.id}" value="${chat.title}" style="display: none;" onclick="event.stopPropagation()">
      <div class="chat-actions">
        <button class="chat-action-btn delete-btn" title="Delete Chat" onclick="event.stopPropagation(); deleteChat('${chat.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // Programmatic double click for rename
    const titleEl = chatItem.querySelector(".chat-title");
    if (titleEl) {
      titleEl.ondblclick = (e) => enableChatRename(e, chat.id);
    }

    // Programmatic input event bindings
    const renameInput = chatItem.querySelector(".chat-rename-input");
    if (renameInput) {
      renameInput.onblur = () => saveChatRename(chat.id);
      renameInput.onkeydown = (e) => handleRenameKey(e, chat.id);
    }

    listContainer.appendChild(chatItem);
  });
}

// Start new empty chat
async function startNewChat() {
  try {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (res.ok) {
      currentChatId = data.chatId;
      await loadChats();
      selectChat(data.chatId);
    } else {
      alert("Failed to create new chat");
    }
  } catch (err) {
    console.error(err);
    alert("Error creating new chat");
  }
}

// Delete chat row
async function deleteChat(chatId) {
  if (!confirm("Are you sure you want to delete this chat and its history?")) {
    return;
  }
  try {
    const res = await fetch(`/api/chats/${chatId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      if (currentChatId === chatId) {
        currentChatId = null;
      }
      await loadChats();
    } else {
      alert("Failed to delete chat");
    }
  } catch (err) {
    console.error(err);
    alert("Error deleting chat");
  }
}

// Enable chat inline rename textfield
function enableChatRename(event, chatId) {
  event.stopPropagation();
  const titleSpan = document.getElementById(`chat-title-${chatId}`);
  const inputEl = document.getElementById(`chat-input-${chatId}`);

  titleSpan.style.display = "none";
  inputEl.style.display = "block";
  inputEl.focus();
  inputEl.select();
}

// Save chat inline rename
async function saveChatRename(chatId) {
  const titleSpan = document.getElementById(`chat-title-${chatId}`);
  const inputEl = document.getElementById(`chat-input-${chatId}`);
  const newTitle = inputEl.value.trim();

  titleSpan.style.display = "block";
  inputEl.style.display = "none";

  if (!newTitle || newTitle === titleSpan.textContent) {
    return;
  }

  try {
    const res = await fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle })
    });
    const data = await res.json();
    if (res.ok) {
      titleSpan.textContent = data.title;
      const chatObj = chatsList.find(c => c.id === chatId);
      if (chatObj) chatObj.title = data.title;
    } else {
      alert(data.error || "Failed to rename chat");
    }
  } catch (err) {
    console.error(err);
    alert("Error renaming chat");
  }
}

// Key event bindings for rename
function handleRenameKey(event, chatId) {
  if (event.key === "Enter") {
    event.preventDefault();
    saveChatRename(chatId);
  } else if (event.key === "Escape") {
    event.preventDefault();
    const titleSpan = document.getElementById(`chat-title-${chatId}`);
    const inputEl = document.getElementById(`chat-input-${chatId}`);
    inputEl.value = titleSpan.textContent;
    titleSpan.style.display = "block";
    inputEl.style.display = "none";
  }
}

// Select/load active chat in frame
async function selectChat(chatId) {
  currentChatId = chatId;

  // Highlight selected chat in UI list
  const items = document.querySelectorAll(".chat-item");
  items.forEach(item => item.classList.remove("active"));

  // Re-render sidebar to update active indicators
  renderChatsList();

  messagesEl.innerHTML = '<div class="loading-messages">Retrieving conversation...</div>';

  try {
    const res = await fetch(`/api/chats/${chatId}/messages`);
    const data = await res.json();
    messagesEl.innerHTML = "";

    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => {
        addMessage(msg.content, msg.sender === 'user' ? 'user' : 'assistant');
      });
    } else {
      messagesEl.innerHTML = `
        <div class="msg-wrapper assistant">
          <div class="msg">This is the start of your persistent chat session. Drop a PDF/text file or toggle Web Search to start!</div>
        </div>
      `;
    }

    if (data.documentName) {
      if (fileDetails) fileDetails.style.display = "flex";
      if (fileNameEl) fileNameEl.textContent = data.documentName;
      if (dropZone) dropZone.style.display = "none";
    } else {
      if (fileDetails) fileDetails.style.display = "none";
      if (fileNameEl) fileNameEl.textContent = "";
      if (dropZone) dropZone.style.display = "flex";
    }
  } catch (err) {
    console.error(err);
    messagesEl.innerHTML = '<div class="error-messages">Failed to load chat history.</div>';
  }
}

// Reset screen states
function resetChatUI() {
  currentChatId = null;
  messagesEl.innerHTML = `
    <div class="msg-wrapper assistant">
      <div class="msg">Hello! I'm your AI Super Assistant. I have advanced capabilities:<br><br><ul><li>🔍 <strong>Web Search:</strong> Toggle search to let me find current facts.</li><li>📄 <strong>Document Q&A:</strong> Drop a PDF or text file in the sidebar to ask questions about it.</li><li>🎤 <strong>Voice Controls:</strong> Try voice typing using the microphone or turn on voice synthesis.</li></ul><br>How can I help you today?</div>
      <div class="msg-meta">
        <button class="speak-btn" onclick="speakMessage(this.parentElement.previousElementSibling.textContent)">
          <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg> Listen
        </button>
      </div>
    </div>
  `;
  if (fileDetails) fileDetails.style.display = "none";
  if (fileNameEl) fileNameEl.textContent = "";
  if (dropZone) dropZone.style.display = "flex";
}

// Auth modal window controls
function openAuthModal(tab = 'login') {
  document.getElementById("authModal").style.display = "flex";
  switchAuthTab(tab);
}

// Close Auth Modal
function closeAuthModal() {
  document.getElementById("authModal").style.display = "none";
  document.getElementById("loginError").style.display = "none";
  document.getElementById("registerError").style.display = "none";
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  if (tab === 'login') {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginForm.style.display = "flex";
    registerForm.style.display = "none";
  } else {
    tabLogin.classList.remove("active");
    tabRegister.classList.add("active");
    loginForm.style.display = "none";
    registerForm.style.display = "flex";
  }
}

// Submit Login credentials
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");

  errorEl.style.display = "none";

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      closeAuthModal();
      document.getElementById("loginForm").reset();
      await checkAuth();
    } else {
      errorEl.textContent = data.error || "Login failed";
      errorEl.style.display = "block";
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Server connection failed.";
    errorEl.style.display = "block";
  }
}

// Submit Register credentials
async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById("registerUsername").value;
  const email = document.getElementById("registerEmail").value;
  const password = document.getElementById("registerPassword").value;
  const errorEl = document.getElementById("registerError");

  errorEl.style.display = "none";

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      closeAuthModal();
      document.getElementById("registerForm").reset();
      await checkAuth();
    } else {
      errorEl.textContent = data.error || "Registration failed";
      errorEl.style.display = "block";
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Server connection failed.";
    errorEl.style.display = "block";
  }
}

// Execute Logout
async function handleLogout() {
  if (!confirm("Are you sure you want to log out?")) return;
  try {
    const res = await fetch("/api/logout", { method: "POST" });
    if (res.ok) {
      await checkAuth();
    } else {
      alert("Logout failed");
    }
  } catch (err) {
    console.error(err);
    alert("Logout failed");
  }
}

// Initial startup execution
checkAuth();
