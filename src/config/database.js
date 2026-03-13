const mongoose = require("mongoose");

const connectDB = async () => {
    await mongoose.connect("mongodb+srv://muthu050:t2RRZICnusHjuayK@namasterdev.ys2cf7s.mongodb.net/Scan_Project");
}

module.exports = connectDB;