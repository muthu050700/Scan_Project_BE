require("dotenv").config();
const express = require("express");
const connectDB = require("./config/database");
const cors = require("cors");

const app = express();

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
connectDB().then(() => {

    console.log("Database connection connected successfully");

    app.listen(7777, () => {
        console.log("Server is successfully listening on port 7777");
    });

}).catch(() => {
    console.log("Database not connected");
});