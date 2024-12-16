const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
require('dotenv').config();

// Database Schema
const stickyNoteSchema = new mongoose.Schema({
  message: {
    type: String,
    required: true,
    maxLength: 500
  },
  signature: {
    type: String,
    required: true,
    unique: true
  },
  walletAddress: {
    type: String,
    required: true
  },
  color: {
    type: String,
    enum: ['pink', 'purple', 'blue', 'green', 'yellow'],
    default: 'yellow'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const StickyNote = mongoose.model('StickyNote', stickyNoteSchema);

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  MESSAGE_MAX_LENGTH: 500,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 100,
  ALLOWED_COLORS: ['pink', 'purple', 'blue', 'green', 'yellow'],
  ALLOWED_ORIGINS: [
    'https://sticky-notes-frontend-b025kwaxx-0xbradens-projects.vercel.app',
    'http://localhost:3000'
  ]
};

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected successfully');
}).catch((error) => {
  console.error('MongoDB connection error:', error);
  process.exit(1);
});

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || CONFIG.ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// Middleware
app.options('*', cors());
app.use(bodyParser.json({ limit: '16kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW,
  max: CONFIG.RATE_LIMIT_MAX,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);

// WebSocket server
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  maxPayload: 1024 * 16,
  verifyClient: ({ origin }, callback) => {
    if (!origin || CONFIG.ALLOWED_ORIGINS.includes(origin)) {
      callback(true);
    } else {
      callback(false);
    }
  }
});

// Input validation middleware
const validateNote = (req, res, next) => {
  const { message, signature, walletAddress, color } = req.body;

  if (!message || !signature || !walletAddress) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (message.length > CONFIG.MESSAGE_MAX_LENGTH) {
    return res.status(400).json({ error: 'Message too long' });
  }

  if (typeof message !== 'string' || typeof signature !== 'string' || typeof walletAddress !== 'string') {
    return res.status(400).json({ error: 'Invalid data types' });
  }

  if (color && !CONFIG.ALLOWED_COLORS.includes(color)) {
    return res.status(400).json({ error: 'Invalid color selection' });
  }

  next();
};

// API Routes
app.get("/api/sticky-notes", async (req, res) => {
  try {
    const notes = await StickyNote.find()
      .sort({ timestamp: -1 })
      .limit(1000);
    res.json(notes);
  } catch (error) {
    console.error('Error fetching sticky notes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post("/api/sticky-notes", validateNote, async (req, res) => {
  try {
    const { message, signature, walletAddress, color } = req.body;
    
    const newNote = new StickyNote({ 
      message, 
      signature, 
      walletAddress,
      color: color || 'yellow',
    });

    await newNote.save();

    // Broadcast to WebSocket clients
    const broadcastData = JSON.stringify(newNote);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(broadcastData);
      }
    });

    res.status(201).json(newNote);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Note with this signature already exists' });
    }
    console.error('Error processing sticky note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket handling
wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  // Setup ping-pong heartbeat
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Clean up on close
  ws.on('close', () => {
    ws.isAlive = false;
  });
});

// Heartbeat interval
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Clean up on server close
wss.on('close', () => {
  clearInterval(interval);
});

// Global error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
server.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
  console.log('Allowed origins:', CONFIG.ALLOWED_ORIGINS);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing HTTP server...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });
});