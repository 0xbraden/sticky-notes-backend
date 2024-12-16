// db.js
const mongoose = require('mongoose');

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

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = { connectDB, StickyNote };