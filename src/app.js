require("dotenv").config();
const express = require("express");
const connectDB = require("./config/database");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 7777;

const corsOptions = {
    origin: "*",           // ✅ wildcard origin
    credentials: false,    // ✅ must be false when origin is "*"
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
};

// ✅ CORS first
app.use(cors(corsOptions));

// ✅ Preflight for all routes (Express 5 syntax)
app.options("/{*path}", cors(corsOptions));

// ✅ JSON after CORS
app.use(express.json());

// ✅ Routes
const OCR_Router = require("./routes/OCR_Route");
app.use("/", OCR_Router);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectDB()
        .then(() => console.log("Database connection connected successfully"))
        .catch((err) => console.error("Database connection failed:", err.message));
});