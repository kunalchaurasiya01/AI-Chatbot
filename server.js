// server.js
// This is the "brain" of your assistant. It receives messages from the
// browser, sends them to Google's Gemini API, and sends the reply back.

require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
let sqlite3;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (e) {
  console.warn('sqlite3 native module not available (expected on Vercel):', e.message);
}
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pdfParse = require("pdf-parse");

// Initialize express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serves our chat UI

// Session middleware (in‑memory store, fine for demo)
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Middleware to attach current user to request if logged in
app.use((req, res, next) => {
  if (req.session.userId) {
    req.userId = req.session.userId;
  }
  next();
});

// Initialize SQLite DB (skip if sqlite3 native module is not available)
let db = null;
if (sqlite3) {
  const IS_VERCEL = process.env.VERCEL === '1';
  const dbPath = IS_VERCEL ? ':memory:' : './db.sqlite';
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to open DB:', err);
      db = null;
    } else {
      console.log('SQLite DB connected');
      // Create tables if they don't exist
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );`);
      db.run(`CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT,
        document_text TEXT,
        document_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`, (err) => {
        if (!err) {
          db.run(`ALTER TABLE chats ADD COLUMN document_text TEXT;`, (err) => { });
          db.run(`ALTER TABLE chats ADD COLUMN document_name TEXT;`, (err) => { });
        }
      });
      db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(chat_id) REFERENCES chats(id)
      );`);
    }
  });
} else {
  console.warn('Running without database — guest mode only.');
}

// Promise wrappers for SQLite queries to make code async/await friendly
const DB_UNAVAILABLE = new Error('Database not available. Please use guest mode.');

const dbRun = (query, params = []) => {
  if (!db) return Promise.reject(DB_UNAVAILABLE);
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (query, params = []) => {
  if (!db) return Promise.reject(DB_UNAVAILABLE);
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (query, params = []) => {
  if (!db) return Promise.reject(DB_UNAVAILABLE);
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Auth Guard Middleware
const requireAuth = (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Configure multer for memory storage of uploaded documents
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// In-memory storage of conversations for non-authenticated guest sessions.
const conversations = {};

// ==========================================
// USER AUTHENTICATION API
// ==========================================

// Register a new user
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required" });
    }

    const existingUser = await dbGet("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await dbRun(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
      [username, email, passwordHash]
    );

    req.session.userId = result.lastID;
    res.json({ message: "Registration successful", user: { id: result.lastID, username, email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    req.session.userId = user.id;
    res.json({ message: "Login successful", user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log in" });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session destruction failed:", err);
      return res.status(500).json({ error: "Failed to log out" });
    }
    res.json({ message: "Logged out successfully" });
  });
});

// Check current user state
app.get("/api/me", async (req, res) => {
  try {
    if (!req.userId) {
      return res.json({ loggedIn: false });
    }
    const user = await dbGet("SELECT id, username, email FROM users WHERE id = ?", [req.userId]);
    if (!user) {
      return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch session information" });
  }
});


// ==========================================
// PERSISTENT CHAT HISTORY & MANAGEMENT API
// ==========================================

// Get list of chats for the logged-in user
app.get("/api/chats", requireAuth, async (req, res) => {
  try {
    const chats = await dbAll("SELECT id, title, document_name, created_at FROM chats WHERE user_id = ? ORDER BY created_at DESC", [req.userId]);
    res.json(chats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retrieve chats" });
  }
});

// Create a new chat session
app.post("/api/chats", requireAuth, async (req, res) => {
  try {
    const result = await dbRun("INSERT INTO chats (user_id, title) VALUES (?, ?)", [req.userId, "New Chat"]);
    res.json({ chatId: result.lastID, title: "New Chat" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create new chat" });
  }
});

// Rename a chat
app.put("/api/chats/:chatId", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const chat = await dbGet("SELECT id FROM chats WHERE id = ? AND user_id = ?", [chatId, req.userId]);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    await dbRun("UPDATE chats SET title = ? WHERE id = ?", [title.trim(), chatId]);
    res.json({ message: "Chat renamed successfully", title: title.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to rename chat" });
  }
});

// Delete a chat session
app.delete("/api/chats/:chatId", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await dbGet("SELECT id FROM chats WHERE id = ? AND user_id = ?", [chatId, req.userId]);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Delete messages first (cascade simulation)
    await dbRun("DELETE FROM messages WHERE chat_id = ?", [chatId]);
    await dbRun("DELETE FROM chats WHERE id = ?", [chatId]);

    res.json({ message: "Chat and its history deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// Get messages for a specific chat
app.get("/api/chats/:chatId/messages", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await dbGet("SELECT id, document_name FROM chats WHERE id = ? AND user_id = ?", [chatId, req.userId]);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const messages = await dbAll("SELECT sender, content, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp ASC", [chatId]);
    res.json({ messages, documentName: chat.document_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retrieve messages" });
  }
});

// Persistent chat endpoint inside a specific chat session
app.post("/api/chats/:chatId/chat", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message, useWebSearch } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const chat = await dbGet("SELECT * FROM chats WHERE id = ? AND user_id = ?", [chatId, req.userId]);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Auto-update title if it's currently default "New Chat"
    if (chat.title === "New Chat") {
      let cleanTitle = message.trim();
      if (cleanTitle.length > 30) {
        cleanTitle = cleanTitle.substring(0, 27) + "...";
      }
      await dbRun("UPDATE chats SET title = ? WHERE id = ?", [cleanTitle, chatId]);
    }

    // Get previous messages to build Gemini context history
    const pastMessages = await dbAll("SELECT sender, content FROM messages WHERE chat_id = ? ORDER BY timestamp ASC", [chatId]);
    const history = pastMessages.map((m) => ({
      role: m.sender === "user" ? "user" : "model",
      parts: [{ text: m.content }]
    }));

    // Add current user message to DB and memory history
    await dbRun("INSERT INTO messages (chat_id, sender, content) VALUES (?, 'user', ?)", [chatId, message]);
    history.push({ role: "user", parts: [{ text: message }] });

    // Prepare system instructions (incorporating document text if uploaded)
    let systemInstructionText = "You are a helpful, friendly AI assistant. Keep answers clear and concise.";
    if (chat.document_text) {
      systemInstructionText += `\n\nYou have access to the document "${chat.document_name}". Answer the user's questions using information from this document. If the user asks about the document, prioritize answering from it. If the answer cannot be found in the document, you may use web search or your general knowledge, but clearly specify that the info is not in the document. Here is the document content:\n${chat.document_text}`;
    }

    // Build payload
    const payload = {
      contents: history,
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      }
    };

    if (useWebSearch) {
      payload.tools = [{ google_search: {} }];
    }

    // Call Gemini API
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error (falling back to mock response):", data);
      const reply = `[API Offline Fallback] I received your message: "${message}". The Gemini API is currently unavailable (rate limit exceeded or offline), but the KC Assistant is running perfectly!`;
      await dbRun("INSERT INTO messages (chat_id, sender, content) VALUES (?, 'model', ?)", [chatId, reply]);
      return res.json({ reply });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
    const grounding = data.candidates?.[0]?.groundingMetadata || null;

    // Save assistant reply to SQLite DB
    await dbRun("INSERT INTO messages (chat_id, sender, content) VALUES (?, 'model', ?)", [chatId, reply]);

    res.json({ reply, grounding });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  }
});

// Persistent upload document endpoint inside a specific chat session
app.post("/api/chats/:chatId/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { chatId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const chat = await dbGet("SELECT id FROM chats WHERE id = ? AND user_id = ?", [chatId, req.userId]);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    let text = "";
    if (file.mimetype === "application/pdf") {
      const parsedData = await pdfParse(file.buffer);
      text = parsedData.text;
    } else if (
      file.mimetype === "text/plain" ||
      file.mimetype === "text/markdown" ||
      file.mimetype === "text/csv" ||
      file.mimetype === "application/json" ||
      file.originalname.endsWith(".txt") ||
      file.originalname.endsWith(".md") ||
      file.originalname.endsWith(".csv") ||
      file.originalname.endsWith(".json")
    ) {
      text = file.buffer.toString("utf-8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload a PDF or text file." });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from the file." });
    }

    // Save context to SQLite
    await dbRun("UPDATE chats SET document_text = ?, document_name = ? WHERE id = ?", [text, file.originalname, chatId]);

    res.json({ message: "File uploaded and parsed successfully", filename: file.originalname });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to process document." });
  }
});

// Persistent clear document endpoint inside a specific chat session
app.post("/api/chats/:chatId/clear-document", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await dbGet("SELECT id FROM chats WHERE id = ? AND user_id = ?", [chatId, req.userId]);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    await dbRun("UPDATE chats SET document_text = NULL, document_name = NULL WHERE id = ?", [chatId]);
    res.json({ message: "Document cleared successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear document from chat." });
  }
});


// ==========================================
// COMPATIBLE FALLBACKS (GUEST MODES)
// ==========================================

// Endpoint to upload and parse documents for Guest Session (PDF or TXT)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const file = req.file;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!conversations[sessionId]) {
      conversations[sessionId] = { history: [], documentText: null, documentName: null };
    } else if (Array.isArray(conversations[sessionId])) {
      conversations[sessionId] = {
        history: conversations[sessionId],
        documentText: null,
        documentName: null
      };
    }

    let text = "";
    if (file.mimetype === "application/pdf") {
      const parsedData = await pdfParse(file.buffer);
      text = parsedData.text;
    } else if (
      file.mimetype === "text/plain" ||
      file.mimetype === "text/markdown" ||
      file.mimetype === "text/csv" ||
      file.mimetype === "application/json" ||
      file.originalname.endsWith(".txt") ||
      file.originalname.endsWith(".md") ||
      file.originalname.endsWith(".csv") ||
      file.originalname.endsWith(".json")
    ) {
      text = file.buffer.toString("utf-8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload a PDF or text file." });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from the file." });
    }

    conversations[sessionId].documentText = text;
    conversations[sessionId].documentName = file.originalname;

    res.json({ message: "File uploaded and parsed successfully", filename: file.originalname });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to process document." });
  }
});

// Endpoint to clear the uploaded document from Guest Session
app.post("/api/clear-document", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (conversations[sessionId]) {
    if (Array.isArray(conversations[sessionId])) {
      conversations[sessionId] = { history: conversations[sessionId], documentText: null, documentName: null };
    } else {
      conversations[sessionId].documentText = null;
      conversations[sessionId].documentName = null;
    }
  }
  res.json({ message: "Document cleared successfully" });
});

// Endpoint to chat with the AI assistant as Guest
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId, useWebSearch } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({ error: "message and sessionId are required" });
    }

    if (!conversations[sessionId]) {
      conversations[sessionId] = { history: [], documentText: null, documentName: null };
    } else if (Array.isArray(conversations[sessionId])) {
      conversations[sessionId] = {
        history: conversations[sessionId],
        documentText: null,
        documentName: null
      };
    }
    const sessionObj = conversations[sessionId];
    const history = sessionObj.history;

    history.push({ role: "user", parts: [{ text: message }] });

    let systemInstructionText = "You are a helpful, friendly AI assistant. Keep answers clear and concise.";
    if (sessionObj.documentText) {
      systemInstructionText += `\n\nYou have access to the document "${sessionObj.documentName}". Answer the user's questions using information from this document. If the user asks about the document, prioritize answering from it. If the answer cannot be found in the document, you may use web search or your general knowledge, but clearly specify that the info is not in the document. Here is the document content:\n${sessionObj.documentText}`;
    }

    const payload = {
      contents: history,
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      }
    };

    if (useWebSearch) {
      payload.tools = [{ google_search: {} }];
    }

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error (falling back to mock response):", data);
      const reply = `[API Offline Fallback] I received your message: "${message}". The Gemini API is currently unavailable (rate limit exceeded or offline), but the KC Assistant is running perfectly!`;
      history.push({ role: "model", parts: [{ text: reply }] });
      return res.json({ reply });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
    const grounding = data.candidates?.[0]?.groundingMetadata || null;

    history.push({ role: "model", parts: [{ text: reply }] });

    res.json({ reply, grounding });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  }
});

// Only start listening when running locally (not on Vercel)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless function
module.exports = app;
