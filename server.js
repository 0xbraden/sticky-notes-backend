const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
require('dotenv').config();

// Add detailed logging
const log = (message, error = null) => {
  console.log(new Date().toISOString(), message);
  if (error) console.error(error);
};

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  MESSAGE_MAX_LENGTH: 500,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 100,
  ALLOWED_COLORS: ['pink', 'purple', 'blue', 'green', 'yellow'],
  ALLOWED_ORIGINS: [
    'https://www.stickynotes.gg',
    'https://sticky-notes-frontend-b025kwaxx-0xbradens-projects.vercel.app',
    'http://localhost:3000'
  ]
};

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

// Initialize Express app
const app = express();
const server = http.createServer(app);

// CORS configuration - more permissive for debugging
app.use(cors({
  origin: true, // Allow all origins temporarily for debugging
  credentials: true
}));

app.use(bodyParser.json({ limit: '16kb' }));

// Connect to MongoDB with detailed error logging
const uri = "mongodb+srv://litterboxbtc:<db_password>@cluster0.6xlky.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  log('MongoDB connected successfully');
})
.catch((error) => {
  log('MongoDB connection error:', error);
  process.exit(1);
});

// Modified GET route with error logging
app.get("/api/sticky-notes", async (req, res) => {
  try {
    log('Fetching sticky notes');
    const notes = await StickyNote.find().sort({ timestamp: -1 }).limit(1000);
    log(`Found ${notes.length} notes`);
    
    // Ensure we're sending an array even if no notes found
    res.json(notes || []);
  } catch (error) {
    log('Error fetching sticky notes:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Modified POST route with error logging
app.post("/api/sticky-notes", async (req, res) => {
  try {
    log('Received new note:', req.body);
    const { message, signature, walletAddress, color } = req.body;
    
    if (!message || !signature || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newNote = new StickyNote({ 
      message, 
      signature, 
      walletAddress,
      color: color || 'yellow',
    });

    const savedNote = await newNote.save();
    log('Note saved successfully:', savedNote);

    // Broadcast to WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(savedNote));
      }
    });

    res.status(201).json(savedNote);
  } catch (error) {
    log('Error saving note:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Note with this signature already exists' });
    }
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  log("New WebSocket connection");
  
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  ws.on('error', (error) => log('WebSocket error:', error));
  ws.on('close', () => log('WebSocket connection closed'));
});

// Start server
server.listen(CONFIG.PORT, () => {
  log(`Server running on port ${CONFIG.PORT}`);
  log('Allowed origins:', CONFIG.ALLOWED_ORIGINS);
});