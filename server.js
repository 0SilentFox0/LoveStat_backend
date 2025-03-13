// server.js - Express server with API routes
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { parseTelegramChat } = require("./chatParser");
const path = require("path");
require("dotenv").config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 5050;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Atlas connection
const connectDB = async () => {
	try {
		if (!process.env.MONGO_URI) {
			throw new Error("MONGO_URI not found in environment variables");
		}

		await mongoose.connect(process.env.MONGO_URI);
		console.log("MongoDB Atlas connected successfully");
	} catch (err) {
		console.error("MongoDB connection error:", err);
		// Exit process with failure if we can't connect to the database
		process.exit(1);
	}
};

// Connect to MongoDB Atlas
connectDB();

// Define schemas
const MonthlyStatSchema = new mongoose.Schema({
	month: { type: String, required: true },
	messageCount: { type: Number, default: 0 },
	photoCount: { type: Number, default: 0 },
	keywords: { type: Map, of: Number },
	keywordsFormatted: [{ name: String, value: Number }],
	emojisFormatted: [{ name: String, value: Number }],
});

const ChatAnalysisSchema = new mongoose.Schema({
	chatName: String,
	chatId: { type: Number, required: true, unique: true },
	totalMessages: Number,
	lastUpdated: { type: Date, default: Date.now },
	monthlyStats: [MonthlyStatSchema],
});

// Create models
const ChatAnalysis =
	mongoose.models.ChatAnalysis ||
	mongoose.model("ChatAnalysis", ChatAnalysisSchema);

// API Routes

/**
 * GET /api/statistics/year/:year
 * Get message statistics for all months in a specific year
 */
app.get("/api/statistics/year/:year", async (req, res) => {
	try {
		const year = req.params.year;

		// Validate year format
		if (!/^\d{4}$/.test(year)) {
			return res.status(400).json({ error: "Invalid year format" });
		}

		// Get the analysis document
		const analysis = await ChatAnalysis.findOne({});

		if (!analysis) {
			return res.status(404).json({ error: "No chat analysis data found" });
		}

		// Filter monthly stats for the requested year
		const yearPrefix = `${year}-`;
		const monthlyData = analysis.monthlyStats
			.filter((stat) => stat.month.startsWith(yearPrefix))
			.map((stat) => ({
				month: stat.month,
				messageCount: stat.messageCount,
			}))
			.sort((a, b) => a.month.localeCompare(b.month));

		res.json(monthlyData);
	} catch (error) {
		console.error("Error fetching year data:", error);
		res.status(500).json({ error: "Server error" });
	}
});

/**
 * GET /api/statistics/:monthKey
 * Get detailed statistics for a specific month
 */
app.get("/api/statistics/:monthKey", async (req, res) => {
	try {
		const monthKey = req.params.monthKey;

		// Validate month key format (YYYY-MM)
		if (!/^\d{4}-\d{2}$/.test(monthKey)) {
			return res
				.status(400)
				.json({ error: "Invalid month format. Use YYYY-MM" });
		}

		// Get the analysis document
		const analysis = await ChatAnalysis.findOne({});

		if (!analysis) {
			return res.status(404).json({ error: "No chat analysis data found" });
		}

		// Find the specific month
		const monthData = analysis.monthlyStats.find(
			(stat) => stat.month === monthKey
		);

		if (!monthData) {
			return res
				.status(404)
				.json({ error: "No data found for the specified month" });
		}

		// Format response
		const response = {
			month: monthData.month,
			totalMessages: monthData.messageCount,
			keywords: monthData.keywordsFormatted.reduce((obj, item) => {
				obj[item.name] = item.value;
				return obj;
			}, {}),
			emojis: monthData.emojisFormatted.reduce((obj, item) => {
				obj[item.name] = item.value;
				return obj;
			}, {}),
			memeCount: monthData.photoCount || 0,
		};

		res.json(response);
	} catch (error) {
		console.error("Error fetching month analysis:", error);
		res.status(500).json({ error: "Server error" });
	}
});

/**
 * POST /api/analyze/file
 * Trigger analysis of a chat export file
 */
app.post("/api/analyze/file", async (req, res) => {
	try {
		const filePath = req.body.filePath || path.join(__dirname, "result.json");

		// Validate if file exists
		if (!fs.existsSync(filePath)) {
			return res
				.status(400)
				.json({ error: "File not found at specified path" });
		}

		// Trigger analysis
		await parseTelegramChat(filePath);

		res.json({ success: true, message: "Chat analysis completed" });
	} catch (error) {
		console.error("Error analyzing chat file:", error);
		res.status(500).json({ error: "Analysis failed", details: error.message });
	}
});

/**
 * GET /api/gallery/:monthKey
 * Get photo gallery for a specific month
 */
app.get("/api/gallery/:monthKey", async (req, res) => {
	try {
		const monthKey = req.params.monthKey;

		// Validate month key format (YYYY-MM)
		if (!/^\d{4}-\d{2}$/.test(monthKey)) {
			return res
				.status(400)
				.json({ error: "Invalid month format. Use YYYY-MM" });
		}

		// Get the analysis document
		const analysis = await ChatAnalysis.findOne({});

		if (!analysis) {
			return res.status(404).json({ error: "No chat analysis data found" });
		}

		// Find the specific month
		const monthData = analysis.monthlyStats.find(
			(stat) => stat.month === monthKey
		);

		if (!monthData) {
			return res
				.status(404)
				.json({ error: "No data found for the specified month" });
		}

		// Create gallery data
		const photoCount = monthData.photoCount || 0;
		const galleryItems = Array.from(
			{ length: Math.min(photoCount, 10) },
			(_, i) => ({
				id: `${monthKey}-photo-${i + 1}`,
				url: `/api/placeholder/400/300`, // In a real app, these would be actual URLs
				caption: `Photo ${i + 1} of ${photoCount}`,
			})
		);

		res.json({
			month: monthKey,
			totalPhotos: photoCount,
			featuredPhotos: galleryItems.slice(0, 2),
			gallery: galleryItems,
		});
	} catch (error) {
		console.error("Error fetching gallery:", error);
		res.status(500).json({ error: "Server error" });
	}
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get("/api/health", (req, res) => {
	res.json({ status: "ok", version: "1.0.0" });
});

let server;

// Only start the server if we're not in a serverless environment
if (process.env.NODE_ENV !== "production") {
	server = app.listen(PORT, () => {
		console.log(`Server running on port ${PORT}`);
	});

	// Handle server shutdown gracefully
	process.on("SIGTERM", () => {
		console.log("SIGTERM signal received: closing HTTP server");
		server.close(() => {
			console.log("HTTP server closed");
			mongoose.connection.close(false, () => {
				console.log("MongoDB connection closed");
				process.exit(0);
			});
		});
	});
}

module.exports = app;
