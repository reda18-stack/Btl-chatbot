// server.js
// Full-featured Nyx backend (text-only)
// Features: JSON responses, commands, memory, JWT auth, MongoDB storage, rate limiting, personality, Gemini AI

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { GoogleGenAI } = require('@google/genai');

// -------------------
// Config / env checks
// -------------------
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const MONGO_URI = process.env.MONGO_URI || null;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret'; // change in production

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY not set. AI calls will fail until you set it in .env.');
}

// -------------------
// Initialize Gemini
// -------------------
let ai = null;
try {
  if (GEMINI_API_KEY) {
    ai = new GoogleGenAI(GEMINI_API_KEY);
  }
} catch (err) {
  console.error('Failed to init GoogleGenAI client:', err && err.message);
  ai = null;
}

// -------------------
// Optional JSON data
// -------------------
// Put responses.json, commands.json, personality.json in project root (same dir as server.js)
const loadJSON = (filename) => {
  try {
    const p = path.join(__dirname, filename);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (err) {
    console.error(`Failed to load ${filename}:`, err.message);
  }
  return null;
};

const responsesJSON = loadJSON('responses.json') || {};     // { "hello": "Hi!" }
const commandsJSON = loadJSON('commands.json') || {};       // { "about": "I am Nyx..." }
const personalityJSON = loadJSON('personality.json') || {};  // { "tone": "...", "greeting": "..." }

// -------------------
// Setup MongoDB (optional)
// -------------------
let useMongo = false;
if (MONGO_URI) {
  mongoose.connect(MONGO_URI, {
    // useNewUrlParser: true, useUnifiedTopology: true  // not needed in mongoose v6+
  }).then(() => {
    useMongo = true;
    console.log('Connected to MongoDB');
  }).catch(err => {
    console.error('MongoDB connection error:', err.message);
  });
} else {
  console.log('No MONGO_URI provided. Running without persistent DB. Messages and memory will not persist.');
}

// -------------------
// Mongoose schemas
// -------------------
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, index: true },
  email: String,
  passwordHash: String,
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null means anonymous
  role: { type: String, enum: ['user','bot'], required: true },
  text: String,
  createdAt: { type: Date, default: Date.now }
});

const memorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  key: String,
  value: String,
  createdAt: { type: Date, default: Date.now }
});

// Only create models if mongoose is connected later (avoid errors if not using DB)
let User = null, Message = null, Memory = null;
if (mongoose.connection) {
  try {
    User = mongoose.model('User', userSchema);
    Message = mongoose.model('Message', messageSchema);
    Memory = mongoose.model('Memory', memorySchema);
  } catch (err) {
    // Models may be created later after connection
  }
}

// -------------------
// Express app
// -------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// -------------------
// Simple in-memory rate limiter
// -------------------
const RATE_LIMIT_WINDOW_MS = 10 * 1000; // 10 seconds
const RATE_LIMIT_MAX = 6;               // max requests per window
const rateMap = new Map(); // key: ip, value: {count, firstTs}

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, firstTs: now };

  if (now - entry.firstTs > RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.firstTs = now;
  } else {
    entry.count++;
  }

  rateMap.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ text: 'Too many requests — slow down.' });
  }
  next();
}

// -------------------
// Helper utilities
// -------------------
function normalizeText(s) {
  if (!s) return '';
  return s.trim().toLowerCase();
}

function applyPersonalityPrompt(userText) {
  // If personality JSON defines tone or style, inject a brief system instruction
  let extra = '';
  if (personalityJSON && typeof personalityJSON === 'object') {
    if (personalityJSON.greeting) {
      extra += ` You are known to start with: "${personalityJSON.greeting}".`;
    }
    if (personalityJSON.tone) {
      extra += ` Adopt a tone: ${personalityJSON.tone}.`;
    }
    if (personalityJSON.style) {
      extra += ` Keep a style: ${personalityJSON.style}.`;
    }
  }
  // Return a combined prompt; for Gemini we pass the user's message but we can influence via systemInstruction when calling.
  return { prompt: userText, extraSystem: extra };
}

// Create JWT token
function createToken(user) {
  return jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

// Middleware: optional authentication via Bearer token
async function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) {
    req.user = null;
    return next();
  }
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    if (useMongo && User) {
      const user = await User.findById(payload.id).lean();
      req.user = user || null;
    } else {
      req.user = { id: payload.id, username: payload.username };
    }
  } catch (err) {
    req.user = null;
  }
  next();
}

// Save message to DB if available
async function saveMessage(userId, role, text) {
  try {
    if (useMongo && Message) {
      return await Message.create({ userId: userId || null, role, text });
    }
  } catch (err) {
    console.error('Failed to save message:', err.message);
  }
  return null;
}

// -------------------
// Routes
// -------------------

// Health check
app.get('/api/health', (req, res) => {
  return res.json({ ok: true, usingMongo: !!useMongo });
});

// ------------ AUTH (register/login) ------------
app.post('/api/auth/register', rateLimiter, async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ text: 'username and password are required' });
  }

  if (!useMongo || !User) {
    return res.status(500).json({ text: 'Registration requires MongoDB. MONGO_URI is not configured.' });
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ text: 'Username already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email: email || '', passwordHash: hash });
    const token = createToken(user);
    return res.json({ text: 'Registered', token, user: { id: user._id, username: user.username } });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ text: 'Registration failed' });
  }
});

app.post('/api/auth/login', rateLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ text: 'username and password are required' });
  }

  if (!useMongo || !User) {
    return res.status(500).json({ text: 'Login requires MongoDB. MONGO_URI is not configured.' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ text: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ text: 'Invalid credentials' });

    const token = createToken(user);
    return res.json({ text: 'Logged in', token, user: { id: user._id, username: user.username } });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ text: 'Login failed' });
  }
});

// ------------ MEMORY ------------
// Save a memory (requires auth)
app.post('/api/memory', authMiddleware, rateLimiter, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ text: 'Authentication required' });

  const { key, value } = req.body || {};
  if (!key || !value) return res.status(400).json({ text: 'key and value are required' });

  if (!useMongo || !Memory) {
    return res.status(500).json({ text: 'Memory storage requires MongoDB. MONGO_URI is not configured.' });
  }

  try {
    // Upsert memory by user+key
    const mem = await Memory.findOneAndUpdate(
      { userId: user.id, key },
      { value },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ text: 'Memory saved', memory: mem });
  } catch (err) {
    console.error('Memory save error:', err.message);
    return res.status(500).json({ text: 'Failed to save memory' });
  }
});

// Get a memory (requires auth)
app.get('/api/memory/:key', authMiddleware, rateLimiter, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ text: 'Authentication required' });

  const key = req.params.key;
  if (!useMongo || !Memory) {
    return res.status(500).json({ text: 'Memory storage requires MongoDB. MONGO_URI is not configured.' });
  }

  try {
    const mem = await Memory.findOne({ userId: user.id, key }).lean();
    if (!mem) return res.status(404).json({ text: 'Memory not found' });
    return res.json({ text: 'Memory found', memory: mem });
  } catch (err) {
    console.error('Memory read error:', err.message);
    return res.status(500).json({ text: 'Failed to read memory' });
  }
});

// ------------ COMMANDS LIST (for frontend) ------------
app.get('/api/commands', (req, res) => {
  // Combine built-in commands and JSON commands
  const builtIn = {
    help: 'List available commands',
    about: 'About Nyx',
    clear: 'Clear local chat (frontend)',
    status: 'Server status'
  };
  const combined = { ...builtIn, ...commandsJSON };
  return res.json({ commands: combined });
});

// ------------ CHAT ROUTE (main) ------------
// Accepts { prompt: "...", history: [...] } and optional Authorization Bearer token for user context
app.post('/api/chat', authMiddleware, rateLimiter, async (req, res) => {
  const user = req.user || null;
  const userId = user ? user._id || user.id : null;

  // *** FIX 1: Check for 'prompt' (sent by index.html) instead of 'message' ***
  const userMessage = (req.body && req.body.prompt) ? String(req.body.prompt) : '';
  // *** FIX 2: Capture the conversation history sent by index.html ***
  const history = (req.body && req.body.history) ? req.body.history : [];

  // This check now uses 'userMessage' (which is req.body.prompt)
  if (!userMessage) return res.status(400).json({ text: "Missing 'message' in request body." });

  // Save incoming user message (if DB present)
  saveMessage(userId, 'user', userMessage);

  // 1) Check for command style messages (start with / or exactly match a command)
  const trimmed = userMessage.trim();
  if (trimmed.startsWith('/')) {
    const cmd = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
    // Built-in commands
    if (cmd === 'help') {
      const help = Object.keys({ ...commandsJSON }).join(', ');
      const text = `Available commands: /help /about /clear /status and custom commands: ${help}`;
      await saveMessage(userId, 'bot', text);
      return res.json({ text });
    }
    if (cmd === 'about') {
      const aboutText = commandsJSON.about || 'Nyx is a friendly AI chatbot.';
      await saveMessage(userId, 'bot', aboutText);
      return res.json({ text: aboutText });
    }
    if (cmd === 'status') {
      const text = `Server OK. usingMongo=${!!useMongo}.`;
      await saveMessage(userId, 'bot', text);
      return res.json({ text });
    }
    if (commandsJSON[cmd]) {
      const text = commandsJSON[cmd];
      await saveMessage(userId, 'bot', text);
      return res.json({ text });
    }
    // unknown command
    const unknown = `Unknown command: ${cmd}. Try /help`;
    await saveMessage(userId, 'bot', unknown);
    return res.json({ text: unknown });
  }

  // 2) Check for exact matches in responses.json (simple rule-based)
  const normalized = normalizeText(userMessage);
  if (responsesJSON && responsesJSON[normalized]) {
    const reply = responsesJSON[normalized];
    await saveMessage(userId, 'bot', reply);
    return res.json({ text: reply });
  }

  // 3) Memory quick sets: "remember key: value" or "my name is ..." simple heuristics
  const lower = normalized;
  const rememberMatch = lower.match(/^remember\s+(.+?):\s*(.+)$/);
  if (rememberMatch && user) {
    const key = rememberMatch[1].trim();
    const value = rememberMatch[2].trim();
    if (useMongo && Memory) {
      try {
        const mem = await Memory.findOneAndUpdate(
          { userId, key },
          { value },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const text = `Saved memory '${key}'.`;
        await saveMessage(userId, 'bot', text);
        return res.json({ text });
      } catch (err) {
        console.error('Memory save error:', err.message);
      }
    } else {
      const text = 'Memory storage not available (no DB).';
      await saveMessage(userId, 'bot', text);
      return res.json({ text });
    }
  }

  // 4) If user asked to retrieve memory: "what is my <key>" or "remembered <key>"
  const recallMatch = lower.match(/^(what is|what's|show)\s+(my\s+)?(.+)$/);
  if (recallMatch && user) {
    const possibleKey = recallMatch[3].trim();
    if (useMongo && Memory) {
      const mem = await Memory.findOne({ userId, key: possibleKey }).lean();
      if (mem) {
        const text = `Memory '${possibleKey}': ${mem.value}`;
        await saveMessage(userId, 'bot', text);
        return res.json({ text });
      }
    }
  }

  // 5) Fallback: use Gemini AI (text-only). Build system instruction using personality JSON.
  let systemInstruction = "You are Nyx, a friendly assistant. Keep replies short and helpful.";
  if (personalityJSON && typeof personalityJSON === 'object') {
    // build small instruction
    if (personalityJSON.tone) systemInstruction += ` Tone: ${personalityJSON.tone}.`;
    if (personalityJSON.style) systemInstruction += ` Style: ${personalityJSON.style}.`;
  }

  // *** FIX 3: Combine received history and current message into the final contents array ***
  const contents = [...history, { role: 'user', parts: [{ text: userMessage }] }];

  try {
    if (!ai) {
      const fallbackText = "AI backend not configured (no GEMINI_API_KEY). Please set GEMINI_API_KEY in .env.";
      await saveMessage(userId, 'bot', fallbackText);
      return res.json({ text: fallbackText });
    }

    const aiResp = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      // Pass the complete conversation history (contents)
      contents: contents,
      config: {
        systemInstruction: systemInstruction
      }
    });

    const botReply = (aiResp && aiResp.text) ? String(aiResp.text).trim() : "I couldn't think of a reply.";
    await saveMessage(userId, 'bot', botReply);
    return res.json({ text: botReply });
  } catch (err) {
    console.error('AI error:', err && err.message ? err.message : err);
    const fallback = 'Nyx had an error contacting AI. Try again later.';
    await saveMessage(userId, 'bot', fallback);
    return res.status(500).json({ text: fallback });
  }
});

// ------------ Admin / utilities --------------

// Clear all memories for current user
app.post('/api/memory/clear', authMiddleware, rateLimiter, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ text: 'Authentication required' });
  if (!useMongo || !Memory) return res.status(500).json({ text: 'Memory not enabled.' });

  try {
    await Memory.deleteMany({ userId: user.id });
    return res.json({ text: 'All memories cleared.' });
  } catch (err) {
    console.error('Memory clear error:', err.message);
    return res.status(500).json({ text: 'Failed to clear memories.' });
  }
});

// Get last N messages (admin-ish)
app.get('/api/messages/recent', rateLimiter, async (req, res) => {
  if (!useMongo || !Message) return res.status(500).json({ text: 'Messages require MongoDB.' });
  const n = Math.min(100, Math.max(1, parseInt(req.query.n || '20', 10)));
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(n).lean();
    return res.json({ messages: msgs });
  } catch (err) {
    console.error('Recent messages error:', err.message);
    return res.status(500).json({ text: 'Failed to read messages.' });
  }
});

// -------------------
// Start server
// -------------------
app.listen(PORT, () => {
  console.log(`Nyx server listening on http://localhost:${PORT}`);
  console.log(`Using Gemini API: ${!!GEMINI_API_KEY}`);
  console.log(`Using MongoDB: ${!!MONGO_URI}`);
});
