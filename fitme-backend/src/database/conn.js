const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const mongoURI = process.env.MONGODB_URI || (isDevelopment ? 'mongodb://localhost:27017/fitness-tracker' : null);

    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is required outside development');
    }

    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
