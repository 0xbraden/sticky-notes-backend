const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");
const rateLimit = require('express-rate-limit');
const { connectDB, StickyNote } = require('./db');
require('dotenv').config();

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  MESSAGE_MAX_LENGTH: 500,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 100,
  ALLOWED_COLORS: ['pink', 'purple', 'blue', 'green', 'yellow']
};

// Initialize Express app and connect to database
const app = express();
const server = http.createServer(app);
connectDB();

// WebSocket server setup remains the same
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  maxPayload: 1024 * 16
});

// Middleware remains the same
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://sticky-notes-frontend-nine.vercel.app']
    : 'http://localhost:3000',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(limiter);
app.use(bodyParser.json({ limit: '16kb' }));

// Modified API Routes
app.get("/api/sticky-notes", async (req, res) => {
  try {
    const notes = await StickyNote.find().sort({ timestamp: -1 }).limit(1000);
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
    if (error.code === 11000) { // Duplicate key error
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

// Heartbeat interval to check for stale connections
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

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
server.listen(CONFIG.PORT, () => {
  console.log(`Server running on http://localhost:${CONFIG.PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing HTTP server...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});