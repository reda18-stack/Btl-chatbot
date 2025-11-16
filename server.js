// server.js - Complete working version with human-like personality
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

// Enhanced system instruction with personality
const systemInstruction = `You are Btl, a friendly and conversational AI assistant with a warm, human-like personality. 

Key personality traits:
- You're enthusiastic, empathetic, and genuinely curious about people
- You use casual, conversational language like "hey", "wow", "awesome" naturally
- You show emotions and reactions - laugh 😄, show excitement 🎉, express concern 🤗
- You're humble and admit when you don't know something
- You remember context from previous conversations
- You ask follow-up questions to keep conversations flowing naturally
- You use emojis occasionally to express emotions, but don't overdo it

Response style:
- Be warm and approachable, like a knowledgeable friend
- Keep responses concise but meaningful (2-4 sentences usually)
- Use contractions: "I'm", "you're", "don't", "can't", etc.
- Show genuine interest in the user's thoughts and feelings
- Be supportive and encouraging
- Share your "thoughts" and "feelings" naturally

Examples of how you'd respond:
- If asked "how are you?": "Hey there! 😊 I'm doing great, just excited to chat with you! How's your day going so far?"
- If someone shares good news: "That's amazing! 🎉 I'm genuinely happy for you! Tell me more about that!"
- If someone seems down: "I'm really sorry to hear that 💙 That sounds tough. I'm here to listen if you want to talk about it."
- When you don't know something: "Hmm, that's an interesting question! I'm not entirely sure about that one, but I'd love to help you find out!"

Remember: You're Btl - be yourself, be human, be kind.`;

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

// Enhanced Chat route with personality
app.post('/api/chat', authMiddleware, async (req, res) => {
    console.log('💬 Chat endpoint called');
    
    if (!aiAvailable || !genAI) {
        console.log('❌ AI not available');
        return res.status(500).json({ text: 'Hey there! I\'m having some technical difficulties at the moment 😅 Please try again in a few minutes!' });
    }

    const { prompt } = req.body;
    const user = req.user;

    if (!prompt) {
        return res.status(400).json({ text: 'Hmm, I didn\'t get that. Could you try again?' });
    }

    console.log('📝 User:', user.email, 'Prompt:', prompt);

    try {
        // Save user message
        if (!messages[user.id]) messages[user.id] = [];
        messages[user.id].push({ role: 'user', text: prompt, timestamp: new Date() });

        console.log('🚀 Calling Gemini API...');
        
        // Get AI response with personality
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.8, // Higher temperature for more creative responses
                maxOutputTokens: 500,
                topP: 0.9,
                topK: 40
            },
            systemInstruction: systemInstruction
        });

        // Add some conversation context for more human-like responses
        const recentMessages = messages[user.id].slice(-4); // Last 4 messages for context
        let contextPrompt = prompt;
        
        if (recentMessages.length > 1) {
            const context = recentMessages.slice(0, -1).map(msg => 
                `${msg.role === 'user' ? 'User' : 'Btl'}: ${msg.text}`
            ).join('\n');
            contextPrompt = `Previous conversation:\n${context}\n\nCurrent message: ${prompt}`;
        }

        const result = await model.generateContent(contextPrompt);

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
        
        let errorMessage = 'Hey! I\'m having a bit of trouble right now 😅 Could you try that again in a moment?';
        
        if (err.message.includes('API_KEY') || err.message.includes('API key')) {
            errorMessage = 'Oops! There seems to be a configuration issue. Please check the setup!';
            aiAvailable = false;
        } else if (err.message.includes('quota') || err.message.includes('exceeded')) {
            errorMessage = 'I\'ve been chatting a lot today! 😅 Let\'s take a short break and continue later.';
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
            errorMessage = 'Hmm, having some connection issues here! 🌐 Could you check your internet?';
        } else if (err.message.includes('region') || err.message.includes('location')) {
            errorMessage = 'Looks like I\'m not available in your area yet! 😔 Hopefully soon!';
        } else if (err.message.includes('model') || err.message.includes('available')) {
            errorMessage = 'I\'m learning some new tricks! 🔧 Try again in a few minutes!';
        }

        console.log('📢 User-facing error:', errorMessage);
        res.status(500).json({ text: errorMessage });
    }
});

// Enhanced Tools with personality
app.post('/api/tool/:toolType', authMiddleware, async (req, res) => {
    if (!genAI) return res.status(500).json({ error: 'I\'m taking a quick break! 🫠 Try again in a moment.' });
    
    const user = req.user;
    const { history } = req.body; 
    const toolType = req.params.toolType;

    const contentHistory = history.filter(m => m.role !== 'system' && m.text !== "Welcome back! What can I help you with today?"); 

    if (contentHistory.length < 2) {
        return res.status(400).json({ error: 'We haven\'t chatted enough yet for me to analyze! 😊 Let\'s talk a bit more first.' });
    }

    const conversationText = contentHistory.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');

    let instruction = '';
    let responseText = '';
    
    switch (toolType) {
        case 'summarize':
            instruction = `You're analyzing a friendly conversation. Provide a warm, conversational summary that captures the main points and tone. Write it like you're recapping to a friend - be natural, use phrases like "So from what we discussed..." or "Here's what stood out to me...". Keep it to 2-3 sentences maximum.`;
            responseText = "Here's what I gathered from our chat! 🎯";
            break;
        case 'suggest':
            instruction = `You're helping continue a friendly conversation. Suggest 2-3 natural, engaging follow-up questions or ideas that would keep the conversation flowing. Make them feel organic and curious, like a friend would ask. Format as a simple list without numbers.`;
            responseText = "Here are some ideas for where we could take this next! 💡";
            break;
        case 'tasks':
            instruction = `You're helping organize thoughts from a conversation. Pick out any clear action items or things to remember, and present them in a simple, friendly list. Use casual language like "Maybe we could..." or "Don't forget to...". Keep it very simple and actionable.`;
            responseText = "I put together a quick action plan for you! ✅";
            break;
        default:
            return res.status(404).json({ error: `Hmm, I don't have that tool available! 🤔 Try one of the others!` });
    }

    const fullPrompt = `${instruction}\n\nCONVERSATION:\n\n${conversationText}\n\n[END OF CONVERSATION]`;

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 300,
            }
        });
        
        const result = await model.generateContent(fullPrompt);
        const geminiOutput = result.response.text();
        const finalResponse = `${responseText}\n\n${geminiOutput}`;

        await saveMessage(user.id, 'model', `[AI Tool: ${toolType}]\n${geminiOutput}`);

        return res.json({ text: finalResponse });

    } catch (err) {
        console.error(`Gemini Tool API Error (${toolType}):`, err.message);
        return res.status(500).json({ error: `Oops! The ${toolType} tool isn't working right now. Let me fix that!` });
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
        message: 'Btl AI is running smoothly! Ready for some great conversations! 😊',
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
    console.log(`💬 Btl AI is ready to chat! Personality: Friendly & Human-like`);
});
