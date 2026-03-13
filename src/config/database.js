const mongoose = require("mongoose");

const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
        console.error("MONGODB_URI is not defined in environment variables");
        return;
    }
    await mongoose.connect(mongoURI);
}

module.exports = connectDB;