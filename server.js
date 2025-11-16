// server.js - Complete working version with fixed message roles
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
let aiAvailable = false;

if (GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        console.log('✅ Gemini AI initialized');
        aiAvailable = true;
    } catch (err) {
        console.error('❌ Gemini AI init failed:', err.message);
        aiAvailable = false;
    }
} else {
    console.log('❌ No Gemini API key found');
    aiAvailable = false;
}

// In-memory storage
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

// Test Gemini API function
async function testGeminiAPI() {
    if (!genAI) {
        return { success: false, error: 'Gemini not initialized' };
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello, respond with 'OK' if you can hear me.");
        const response = result.response.text();
        return { success: true, response };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

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
    console.log('💬 Chat endpoint called');
    
    if (!aiAvailable || !genAI) {
        console.log('❌ AI not available');
        return res.status(500).json({ text: 'AI service is not available. Please check server configuration.' });
    }

    const { prompt } = req.body;
    const user = req.user;

    if (!prompt) {
        return res.status(400).json({ text: 'Prompt is required' });
    }

    console.log('📝 User:', user.email, 'Prompt:', prompt);

    try {
        // Save user message
        if (!messages[user.id]) messages[user.id] = [];
        messages[user.id].push({ role: 'user', text: prompt, timestamp: new Date() });

        console.log('🚀 Calling Gemini API...');
        
        // Get AI response with better error handling
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
                topP: 0.8,
                topK: 40
            }
        });

        const result = await model.generateContent(prompt);

        console.log('✅ Gemini API response received');
        const responseText = result.response.text();
        console.log('🤖 AI Response:', responseText.substring(0, 100) + '...');

        // Save AI response as 'bot' role for consistent client-side display
        messages[user.id].push({ role: 'bot', text: responseText, timestamp: new Date() });

        res.json({ text: responseText });

    } catch (err) {
        console.error('❌ Chat error details:');
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);
        
        let errorMessage = 'AI service temporarily unavailable';
        
        if (err.message.includes('API_KEY') || err.message.includes('API key')) {
            errorMessage = 'Invalid API key. Please check your Gemini API key configuration.';
            aiAvailable = false;
        } else if (err.message.includes('quota') || err.message.includes('exceeded')) {
            errorMessage = 'API quota exceeded. Please try again later.';
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
            errorMessage = 'Network error. Please check your connection.';
        } else if (err.message.includes('region') || err.message.includes('location')) {
            errorMessage = 'Service not available in your region.';
        } else if (err.message.includes('model') || err.message.includes('available')) {
            errorMessage = 'AI model not available. Please try a different model.';
        }

        console.log('📢 User-facing error:', errorMessage);
        res.status(500).json({ text: errorMessage });
    }
});

// Get message history - FIXED: Ensure consistent role format
app.get('/api/messages', authMiddleware, (req, res) => {
    const user = req.user;
    let userMessages = messages[user.id] || [];
    
    // Ensure all messages have consistent roles for client display
    userMessages = userMessages.map(msg => {
        // Convert any 'model' roles to 'bot' for consistent client-side display
        if (msg.role === 'model') {
            return { ...msg, role: 'bot' };
        }
        return msg;
    });
    
    res.json({ messages: userMessages });
});

// Health check with API test
app.get('/api/health', async (req, res) => {
    const apiTest = await testGeminiAPI();
    
    res.json({ 
        status: 'ok', 
        ai_initialized: !!genAI,
        ai_available: aiAvailable,
        api_test: apiTest,
        timestamp: new Date().toISOString(),
        environment: {
            has_api_key: !!GEMINI_API_KEY,
            port: PORT
        }
    });
});

// Debug endpoint to check environment
app.get('/api/debug', (req, res) => {
    res.json({
        node_version: process.version,
        environment_variables: {
            GEMINI_API_KEY: GEMINI_API_KEY ? '***' + GEMINI_API_KEY.slice(-4) : 'NOT SET',
            JWT_SECRET: JWT_SECRET ? 'SET' : 'NOT SET',
            PORT: PORT
        },
        memory_usage: process.memoryUsage(),
        uptime: process.uptime()
    });
});

// Basic route
app.get('/', (req, res) => {
    res.json({ 
        message: 'AI Chatbot API is running!',
        endpoints: {
            health: '/api/health',
            debug: '/api/debug',
            register: '/api/auth/register',
            login: '/api/auth/login',
            chat: '/api/chat'
        }
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🤖 AI Status: ${aiAvailable ? 'Ready' : 'Not available'}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
});
