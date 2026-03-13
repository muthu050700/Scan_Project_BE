require("dotenv").config();
const express = require("express");
const connectDB = require("./config/database");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 7777;
// enable JSON parsing
app.use(express.json());

// enable CORS (development-friendly)
app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        return callback(null, true);
    },
    credentials: true,
}));

// import routes
const OCR_Router = require("./routes/OCR_Route");

// register routes
app.use("/", OCR_Router);

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Connect to database after server starts
    connectDB()
        .then(() => {
            console.log("Database connection connected successfully");
        })
        .catch((err) => {
            console.error("Database connection failed:", err.message);
            // We don't exit the process here to allow the server to remain upright 
            // for Render health checks and potential retry logic or debugging.
        });
});