const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require('fs').promises;
const path = require('path');

// Add detailed logging
const log = (message, error = null) => {
  console.log(new Date().toISOString(), message);
  if (error) console.error(error);
};

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  MESSAGE_MAX_LENGTH: 500,
  ALLOWED_COLORS: ['pink', 'purple', 'blue', 'green', 'yellow'],
  ALLOWED_ORIGINS: [
    '*',
    'https://www.stickynotes.gg',
    'http://localhost:3000'
  ],
  DATA_FILE: path.join(__dirname, 'notes.json')
};

// Helper functions to read/write JSON file
async function readNotes() {
  try {
    const data = await fs.readFile(CONFIG.DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return empty array
      return [];
    }
    throw error;
  }
}

async function writeNotes(notes) {
  await fs.writeFile(CONFIG.DATA_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

// Initialize Express app
const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: CONFIG.ALLOWED_ORIGINS,
  credentials: true
}));

app.use(bodyParser.json({ limit: '16kb' }));

// Modified GET route with error logging
app.get("/api/sticky-notes", async (req, res) => {
  try {
    log('Fetching sticky notes');
    const notes = await readNotes();
    log(`Found ${notes.length} notes`);
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

    const notes = await readNotes();
    
    // Check if signature already exists
    if (notes.some(note => note.signature === signature)) {
      return res.status(400).json({ error: 'Note with this signature already exists' });
    }

    const newNote = {
      message,
      signature,
      walletAddress,
      color: color || 'yellow',
      timestamp: new Date().toISOString()
    };

    notes.unshift(newNote); // Add to beginning of array
    await writeNotes(notes);
    
    log('Note saved successfully:', newNote);

    // Broadcast to WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(newNote));
      }
    });

    res.status(201).json(newNote);
  } catch (error) {
    log('Error saving note:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

// Add heartbeat to keep connections alive
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws) => {
  log("New WebSocket connection");
  
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  
  // Send initial data on connection
  readNotes()
    .then(notes => {
      ws.send(JSON.stringify({ type: 'initial', notes }));
    })
    .catch(error => log('Error fetching initial notes:', error));
    
  ws.on('error', (error) => log('WebSocket error:', error));
  ws.on('close', () => log('WebSocket connection closed'));
});

// Add ping interval
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// Start server
server.listen(CONFIG.PORT, () => {
  log(`Server running on port ${CONFIG.PORT}`);
  log('Allowed origins:', CONFIG.ALLOWED_ORIGINS);
});