// server.js
// Full-featured Nyx backend (text-only)
// Features: JSON responses, commands, memory, JWT auth, MongoDB storage (optional), rate limiting, personality, Gemini AI

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // CHANGED: Use GoogleGenerativeAI instead of GoogleGenAI

// -------------------
// Config / env checks
// -------------------
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const MONGO_URI = process.env.MONGO_URI || null;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

console.log('Environment check:');
console.log('- PORT:', PORT);
console.log('- GEMINI_API_KEY:', GEMINI_API_KEY ? '***' + GEMINI_API_KEY.slice(-4) : 'NOT SET');
console.log('- MONGO_URI:', MONGO_URI ? 'Set' : 'Not set');
console.log('- JWT_SECRET:', JWT_SECRET ? 'Set' : 'Not set');

if (!GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY not set. AI will not work.');
} else {
  console.log('✅ GEMINI_API_KEY is set');
}

// -------------------
// MongoDB and Models Setup
// -------------------
const useMongo = !!MONGO_URI;
let inMemoryUsers = {};
let inMemoryMessages = [];

if (useMongo) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ MongoDB connected successfully.'))
        .catch(err => console.error('❌ MongoDB connection error:', err.message));
} else {
    console.log('ℹ️  MongoDB not configured, using in-memory storage');
}

// Mongoose Models
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});
const User = useMongo ? mongoose.model('User', UserSchema) : null;

const MessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'model'], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Message = useMongo ? mongoose.model('Message', MessageSchema) : null;

// -------------------
// Initialize Gemini
// -------------------
let genAI = null; // CHANGED: renamed from ai to genAI
let chatModel = null;

if (GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY); // CHANGED: Use GoogleGenerativeAI
        // Initialize the model
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
            },
            systemInstruction: "You are a helpful, concise, and professional AI assistant. Respond warmly and directly."
        });
        
        // Start a chat session
        chatModel = model.startChat({
            history: [],
        });
        
        console.log('✅ GoogleGenerativeAI initialized successfully');
    } catch (err) {
        console.error('❌ Failed to init GoogleGenerativeAI client:', err.message);
        genAI = null;
        chatModel = null;
    }
} else {
    console.log('❌ GoogleGenerativeAI not initialized - no API key');
}

// -------------------
// Optional JSON data
// -------------------
let personality = {};
let commands = {};
let responses = {};

function loadJsonFiles() {
    try {
        if (fs.existsSync('personality.json')) {
            personality = JSON.parse(fs.readFileSync('personality.json', 'utf8'));
        }
        if (fs.existsSync('commands.json')) {
            commands = JSON.parse(fs.readFileSync('commands.json', 'utf8'));
        }
        if (fs.existsSync('responses.json')) {
            responses = JSON.parse(fs.readFileSync('responses.json', 'utf8'));
        }
    } catch (e) {
        console.error("Error loading JSON files:", e.message);
    }
}
loadJsonFiles();

// ----------------
// Middleware
// ----------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

// Simple rate limiter
const rateLimiter = (req, res, next) => {
    next();
};

// JWT Authentication Middleware
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Authorization header missing.' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
};

// ----------------
// Utility Functions
// ----------------

// CHANGED: Updated formatHistory function for new API
function formatHistory(history) {
    return history.map(msg => ({
        role: msg.role === 'bot' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));
}

async function saveMessage(userId, role, text) {
    if (useMongo && Message) {
        try {
            await Message.create({ userId, role, text });
        } catch (err) {
            console.error('Failed to save message to MongoDB:', err.message);
        }
    } else {
        inMemoryMessages.push({
            userId,
            role,
            text,
            createdAt: new Date()
        });
    }
}

// ----------------
// Routes: Auth
// ----------------

app.post('/api/auth/register', rateLimiter, async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password || !username) return res.status(400).json({ error: 'Missing fields.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    if (useMongo && User) {
        try {
            const user = await User.create({ email, username, password: hashedPassword });
            const token = jwt.sign({ 
                id: user._id.toString(),
                email: user.email 
            }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ message: 'Registration successful.', token });
        } catch (err) {
            if (err.code === 11000) return res.status(409).json({ error: 'User already exists.' });
            return res.status(500).json({ error: 'Registration failed.' });
        }
    } else {
        if (inMemoryUsers[email]) return res.status(409).json({ error: 'User already exists (in-memory).' });

        const pseudoId = 'guest_' + Date.now(); 
        inMemoryUsers[email] = {
            _id: pseudoId,
            email,
            username,
            password: hashedPassword
        };
        const token = jwt.sign({ 
            id: pseudoId, 
            email: email 
        }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ message: 'Registration successful (in-memory).', token });
    }
});

app.post('/api/auth/login', rateLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password.' });

    let user = null;

    if (useMongo && User) {
        try {
            user = await User.findOne({ email });
            if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
        } catch (err) {
            return res.status(500).json({ error: 'Login failed.' });
        }
    } else {
        user = inMemoryUsers[email];
        if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign({ 
        id: user._id.toString(),
        email: user.email 
    }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ message: 'Login successful.', token });
});

// ----------------
// Routes: AI Chat - UPDATED FOR NEW API
// ----------------

// Main Chat Route
app.post('/api/chat', authMiddleware, rateLimiter, async (req, res) => {
  console.log('🔍 Chat request received');
  
  if (!genAI || !chatModel) {
    console.error('❌ AI client not initialized');
    return res.status(500).json({ text: 'AI service is currently unavailable. Please check server configuration.' });
  }
  
  const user = req.user;
  const { prompt, history } = req.body;
  
  if (!prompt) return res.status(400).json({ text: 'Prompt is required.' });

  console.log('📝 User prompt:', prompt.substring(0, 50) + '...');

  const fallback = 'Sorry, the AI is currently unavailable. Please try again later.';

  try {
    await saveMessage(user.id, 'user', prompt);

    console.log('🚀 Sending request to Gemini API...');
    
    // CHANGED: Use the new API syntax
    const result = await chatModel.sendMessage(prompt);
    const botResponse = result.response.text();
    
    console.log('✅ Gemini API response received');
    console.log('🤖 Bot response:', botResponse.substring(0, 50) + '...');

    await saveMessage(user.id, 'model', botResponse);
    
    return res.json({ text: botResponse });

  } catch (err) {
    console.error('❌ Gemini Chat API Error:', err.message);
    console.error('❌ Error details:', err);
    
    // More specific error messages
    if (err.message.includes('API key') || err.message.includes('API_KEY')) {
        return res.status(500).json({ text: 'AI configuration error: Invalid API key.' });
    } else if (err.message.includes('quota')) {
        return res.status(500).json({ text: 'AI service quota exceeded. Please try again later.' });
    } else if (err.message.includes('network') || err.message.includes('connect')) {
        return res.status(500).json({ text: 'Network error. Please check your connection and try again.' });
    } else {
        return res.status(500).json({ text: 'AI service temporarily unavailable. Please try again in a moment.' });
    }
  }
});

// ----------------
// Routes: Gemini Tools - UPDATED FOR NEW API
// ----------------

app.post('/api/tool/:toolType', authMiddleware, rateLimiter, async (req, res) => {
    if (!genAI) return res.status(500).json({ error: 'AI client not initialized.' });
    const user = req.user;
    const { history } = req.body; 
    const toolType = req.params.toolType;

    const contentHistory = history.filter(m => m.role !== 'system' && m.text !== "Welcome back! What can I help you with today?"); 

    if (contentHistory.length < 2) {
        return res.status(400).json({ error: 'Not enough conversation history to analyze.' });
    }

    const conversationText = contentHistory.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');

    let instruction = '';
    let responseText = '';
    
    switch (toolType) {
        case 'summarize':
            instruction = "You are a conversation summarization expert. Analyze the following chat history between USER and a BOT. Provide a concise, professional, single-paragraph summary of the main topics and conclusions discussed. Do not use bullet points or lists. Start the summary directly, without a greeting.";
            responseText = "Here is a quick summary of your chat:";
            break;
        case 'suggest':
            instruction = "You are a helpful assistant. Analyze the following chat history between USER and a BOT. Suggest exactly three distinct, interesting follow-up questions or actions the user could take next. Format your output as a numbered list (1., 2., 3.). Do not include any introductory or concluding text, just the list.";
            responseText = "Here are some ideas for next steps:";
            break;
        case 'tasks':
            instruction = "You are a task management AI. Analyze the following chat history between USER and a BOT, focusing on the last few turns. Identify any implied or explicit tasks, action items, or things to remember. Generate a concise, simple list of these items. Format your output as a markdown bulleted list using the '-' character. Do not include any introductory or concluding text, just the list.";
            responseText = "I've generated this action plan for you:";
            break;
        default:
            return res.status(404).json({ error: `Unknown tool type: ${toolType}` });
    }

    const fullPrompt = `${instruction}\n\nCONVERSATION HISTORY:\n\n${conversationText}\n\n[END OF HISTORY]`;

    try {
        // CHANGED: Create a new model instance for tool requests
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1000,
            }
        });
        
        const result = await model.generateContent(fullPrompt);
        const geminiOutput = result.response.text();
        const finalResponse = `${responseText}\n\n${geminiOutput}`;

        await saveMessage(user.id, 'model', `[AI Tool: ${toolType}]\n${geminiOutput}`);

        return res.json({ text: finalResponse });

    } catch (err) {
        console.error(`Gemini Tool API Error (${toolType}):`, err.message);
        return res.status(500).json({ error: `Failed to execute AI tool ${toolType}.` });
    }
});

// Get messages for current user
app.get('/api/messages', authMiddleware, rateLimiter, async (req, res) => {
  const user = req.user;
  const n = Math.min(100, Math.max(1, parseInt(req.query.n || '50', 10)));
  
  try {
    let messages = [];
    
    if (useMongo && Message) {
      messages = await Message.find({ userId: user.id })
        .sort({ createdAt: 1 })
        .limit(n)
        .lean();
    } else {
      messages = inMemoryMessages
        .filter(msg => msg.userId === user.id)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(-n);
    }
    
    return res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve messages.' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok',
        ai_initialized: !!genAI,
        mongo_connected: useMongo,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 AI Status: ${genAI ? '✅ Initialized' : '❌ Not available'}`);
});
