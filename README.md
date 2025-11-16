# Btl AI - Intelligent Chatbot Assistant 🤖

![Btl AI](https://img.shields.io/badge/Btl-AI-purple) ![Version](https://img.shields.io/badge/version-1.0.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

A modern, feature-rich AI chatbot powered by Google Gemini with a beautiful glass-morphism interface, dark/light mode, and persistent memory.

![Btl AI Screenshot](https://via.placeholder.com/800x400/9333EA/FFFFFF?text=Btl+AI+Chatbot)

## ✨ Features

### 🤖 AI Capabilities
- **Google Gemini Integration** - Powered by Google's latest AI models
- **Smart Conversations** - Natural, contextual dialogue
- **AI Tools** - Built-in analysis tools:
  - 📝 **Conversation Summarization**
  - 💡 **Next Steps Suggestions**
  - ✅ **Task List Generation**

### 🎨 User Experience
- **Dark/Light Mode** - Toggle between beautiful themes
- **Glass Morphism UI** - Modern frosted glass design
- **Animated Elements** - Floating eyes and smooth transitions
- **Typing Indicators** - Visual feedback when AI is thinking
- **Message Animations** - Smooth slide-in effects

### 💾 Memory & Persistence
- **User Authentication** - Secure login/register system
- **Chat History** - Persistent conversation memory
- **Theme Preference** - Remembers dark/light mode choice
- **Session Management** - Maintains login state

### 📱 Responsive Design
- **Mobile Optimized** - Perfect on all devices
- **Touch Friendly** - Optimized for mobile interactions
- **Cross-Browser** - Works on all modern browsers

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Google Gemini API key
- MongoDB (optional, for production)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/btl-ai.git
cd btl-ai
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Setup**
Create a `.env` file:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
JWT_SECRET=your_jwt_secret_here
MONGO_URI=your_mongodb_uri_here  # Optional
```

4. **Get Gemini API Key**
   - Visit [Google AI Studio](https://aistudio.google.com/)
   - Create a new API key
   - Add it to your `.env` file

5. **Run the application**
```bash
npm start
```

6. **Access the application**
Open `http://localhost:3000` in your browser

## 🛠️ Tech Stack

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with CSS variables
- **JavaScript** - Vanilla JS with modern ES6+ features
- **Tailwind CSS** - Utility-first CSS framework

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Google Generative AI** - AI integration
- **JWT** - Authentication tokens
- **bcrypt** - Password hashing
- **MongoDB** - Database (optional)

### Deployment
- **Railway** - Recommended hosting platform
- **Environment Variables** - Secure configuration

## 📁 Project Structure

```
btl-ai/
├── public/
│   └── index.html          # Main application
├── server.js               # Backend server
├── package.json            # Dependencies and scripts
├── .env.example           # Environment template
└── README.md              # This file
```

## 🔧 Configuration

### Environment Variables
| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `JWT_SECRET` | Secret for JWT tokens | Yes |
| `MONGO_URI` | MongoDB connection string | No |

### Features Configuration
The application supports both MongoDB and in-memory storage:
- **MongoDB**: Persistent data storage (recommended for production)
- **In-memory**: Development and testing (data resets on server restart)

## 🎯 Usage

### Authentication
1. **Register** - Create a new account with email and password
2. **Login** - Access your existing account
3. **Auto-login** - Credentials are remembered between sessions

### Chat Interface
1. **Start Chatting** - Type your message and press Enter
2. **AI Tools** - Click the ✨ button for additional features
3. **Theme Toggle** - Switch between dark/light mode using the sun/moon icon
4. **Navigation** - Access about info and contact details from the menu

### AI Tools
- **Summarize**: Get a concise summary of your conversation
- **Suggest**: Receive follow-up questions and action ideas
- **Tasks**: Generate a structured task list from your chat

## 🚀 Deployment

### Railway (Recommended)
1. Fork this repository
2. Connect your GitHub to [Railway](https://railway.app)
3. Create new project from GitHub repo
4. Add environment variables in Railway dashboard
5. Deploy automatically

### Other Platforms
The application can be deployed on any Node.js hosting platform:
- **Heroku**
- **Vercel**
- **Netlify**
- **DigitalOcean**
- **AWS/Azure**

## 🔒 Security Features

- **JWT Authentication** - Secure token-based auth
- **Password Hashing** - bcrypt for secure password storage
- **CORS Protection** - Cross-origin request security
- **Input Validation** - Server-side validation
- **Rate Limiting** - Basic request limiting

## 🤝 Contributing

We love contributions! Here's how to help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Setup
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests (if available)
npm test
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Google Gemini** - For powerful AI capabilities
- **Tailwind CSS** - For beautiful utility classes
- **Railway** - For seamless deployment
- **Open Source Community** - For inspiration and tools

## 📞 Support

- **Email**: btlreda852@gmail.com
- **Issues**: [GitHub Issues](https://github.com/yourusername/btl-ai/issues)
- **Documentation**: Check the wiki for detailed guides



### Screenshots
| Dark Mode | Light Mode | Mobile View |
|-----------|------------|-------------|
| ![Dark](https://via.placeholder.com/300x200/1f013d/FFFFFF?text=Dark+Mode) | ![Light](https://via.placeholder.com/300x200/f8fafc/1e293b?text=Light+Mode) | ![Mobile](https://via.placeholder.com/300x200/9333ea/FFFFFF?text=Mobile+View) |

---

**Built with ❤️ by Red4**

⭐ Star this repository if you find it helpful!
