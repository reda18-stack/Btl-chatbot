// server.js - Minimal working version
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Config
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

console.log('🚀 Starting server...');
console.log('- PORT:', PORT);
console.log('- GEMINI_API_KEY:', GEMINI_API_KEY ? '***' + GEMINI_API_KEY.slice(-4) : 'NOT SET');

// Initialize Gemini AI
let genAI = null;
if (GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        console.log('✅ Gemini AI initialized');
    } catch (err) {
        console.error('❌ Gemini AI init failed:', err.message);
    }
} else {
    console.log('❌ No Gemini API key found');
}

// In-memory storage (for demo - use database in production)
const users = {};
const messages = {};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Auth middleware
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Authorization header missing' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Routes
app.post('/api/auth/register', async (req, res) => {
    const { email, password, username = email } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    if (users[email]) {
        return res.status(409).json({ error: 'User already exists' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = 'user_' + Date.now();
        
        users[email] = {
            id: userId,
            email,
            username,
            password: hashedPassword
        };

        messages[userId] = [];

        const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({ message: 'Registration successful', token });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    const user = users[email];
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Login successful', token });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Chat route
app.post('/api/chat', authMiddleware, async (req, res) => {
    if (!genAI) {
        return res.status(500).json({ text: 'AI service not available' });
    }

    const { prompt } = req.body;
    const user = req.user;

    if (!prompt) {
        return res.status(400).json({ text: 'Prompt is required' });
    }

    console.log('💬 Chat request from:', user.email, 'Prompt:', prompt.substring(0, 50));

    try {
        // Save user message
        if (!messages[user.id]) messages[user.id] = [];
        messages[user.id].push({ role: 'user', text: prompt, timestamp: new Date() });

        // Get AI response
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
            }
        });

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Save AI response
        messages[user.id].push({ role: 'bot', text: responseText, timestamp: new Date() });

        res.json({ text: responseText });
    } catch (err) {
        console.error('❌ Chat error:', err.message);
        
        let errorMessage = 'AI service error';
        if (err.message.includes('API_KEY')) {
            errorMessage = 'Invalid API key - check your Gemini API key';
        } else if (err.message.includes('quota')) {
            errorMessage = 'API quota exceeded';
        } else if (err.message.includes('network')) {
            errorMessage = 'Network error - check your connection';
        }

        res.status(500).json({ text: errorMessage });
    }
});

// Get message history
app.get('/api/messages', authMiddleware, (req, res) => {
    const user = req.user;
    const userMessages = messages[user.id] || [];
    res.json({ messages: userMessages });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        ai: !!genAI,
        timestamp: new Date().toISOString()
    });
});

// Basic route
app.get('/', (req, res) => {
    res.json({ message: 'AI Chatbot API is running!' });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🤖 AI Status: ${genAI ? 'Ready' : 'Not available'}`);
});
