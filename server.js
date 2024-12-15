const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");
const rateLimit = require('express-rate-limit');

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  MAX_NOTES: 1000, // Maximum number of notes to store in memory
  MESSAGE_MAX_LENGTH: 500, // Maximum length of a sticky note message
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX: 100, // Maximum requests per window
  ALLOWED_COLORS: ['pink', 'purple', 'blue', 'green', 'yellow'] // Valid color options
};

// Initialize Express app
const app = express();
const server = http.createServer(app);

// WebSocket server with ping-pong heartbeat
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  maxPayload: 1024 * 16 // 16kb max payload size
});

// In-memory storage with circular buffer behavior
const stickyNotes = [];

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] // Replace with your production domain
    : 'http://localhost:3000',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW,
  max: CONFIG.RATE_LIMIT_MAX,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);
app.use(bodyParser.json({ limit: '16kb' }));

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

  // Validate color if provided
  if (color && !CONFIG.ALLOWED_COLORS.includes(color)) {
    return res.status(400).json({ error: 'Invalid color selection' });
  }

  next();
};

// API Routes
app.get("/api/sticky-notes", (req, res) => {
  res.json(stickyNotes);
});

app.post("/api/sticky-notes", validateNote, (req, res) => {
  try {
    const { message, signature, walletAddress, color } = req.body;
    const timestamp = new Date().toISOString();

    const newNote = { 
      message, 
      signature, 
      walletAddress,
      color: color || 'yellow', // Default to yellow if no color provided
      timestamp,
      id: `${signature.slice(0, 8)}-${Date.now()}` 
    };

    // Implement circular buffer
    if (stickyNotes.length >= CONFIG.MAX_NOTES) {
      stickyNotes.shift(); // Remove oldest note
    }
    
    stickyNotes.push(newNote);

    // Broadcast to WebSocket clients
    const broadcastData = JSON.stringify(newNote);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(broadcastData);
      }
    });

    res.status(201).json(newNote);
  } catch (error) {
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