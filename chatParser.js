// chatParser.js
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const emojiRegex = require("emoji-regex");
require("dotenv").config(); // Load environment variables

/**
 * Parse Telegram JSON chat export and analyze data
 * @param {string} filePath - Path to the JSON file
 * @returns {Object} Analysis results
 */
async function parseTelegramChat(filePath) {
	try {
		// Read and parse the JSON file
		const rawData = fs.readFileSync(filePath, "utf8");
		const chatData = JSON.parse(rawData);

		console.log(`Parsing chat with ${chatData.messages.length} messages...`);

		// Perform analysis
		const analysis = analyzeChat(chatData);

		// Log the results
		console.log("Analysis completed:");
		console.log(JSON.stringify(analysis, null, 2));

		// Store in MongoDB
		await storeAnalysisInMongoDB(analysis);

		return analysis;
	} catch (error) {
		console.error("Error parsing chat data:", error);
		throw error;
	}
}

/**
 * Analyze chat data to extract statistics
 * @param {Object} chatData - The parsed chat JSON object
 * @returns {Object} Monthly statistics
 */
function analyzeChat(chatData) {
	// Initialize result object for monthly stats
	const monthlyStats = {};

	// Keywords to look for (case insensitive)
	const keywords = ["Добраніч", "Солодких", "Доброго ранку", "Скучив"];

	// Process each message
	chatData.messages.forEach((message) => {
		// Skip non-message types
		if (message.type !== "message") return;

		// Extract date and create month key (YYYY-MM format)
		const messageDate = new Date(message.date);
		const monthKey = `${messageDate.getFullYear()}-${String(
			messageDate.getMonth() + 1
		).padStart(2, "0")}`;

		// Initialize month data if not exists
		if (!monthlyStats[monthKey]) {
			monthlyStats[monthKey] = {
				month: monthKey,
				messageCount: 0,
				photoCount: 0,
				keywords: keywords.reduce((obj, keyword) => {
					obj[keyword.toLowerCase()] = 0;
					return obj;
				}, {}),
				emojis: {},
				topEmojis: [],
			};
		}

		// Count message
		monthlyStats[monthKey].messageCount++;

		// Check for photos
		if (
			message.photo ||
			(message.media_type && message.media_type === "photo") ||
			message.photo_id
		) {
			monthlyStats[monthKey].photoCount++;
		}

		// Process text content if exists
		if (message.text) {
			// Convert to string if it's not already
			const messageText =
				typeof message.text === "string"
					? message.text
					: JSON.stringify(message.text);

			// Count keywords (case insensitive)
			keywords.forEach((keyword) => {
				const regex = new RegExp(keyword, "gi");
				const matches = messageText.match(regex);
				if (matches) {
					monthlyStats[monthKey].keywords[keyword.toLowerCase()] +=
						matches.length;
				}
			});

			// Count emojis
			const regex = emojiRegex();
			let match;
			while ((match = regex.exec(messageText))) {
				const emoji = match[0];
				monthlyStats[monthKey].emojis[emoji] =
					(monthlyStats[monthKey].emojis[emoji] || 0) + 1;
			}
		}
	});

	// Process monthly data to get top emojis
	Object.keys(monthlyStats).forEach((monthKey) => {
		const emojiCounts = monthlyStats[monthKey].emojis;

		// Convert emoji counts to array and sort by count
		const emojiArray = Object.entries(emojiCounts)
			.map(([emoji, count]) => ({
				emoji,
				count,
			}))
			.sort((a, b) => b.count - a.count);

		// Get top 4 emojis (or fewer if there aren't 4)
		monthlyStats[monthKey].topEmojis = emojiArray.slice(0, 4);

		// Format keywords for API
		monthlyStats[monthKey].keywordsFormatted = Object.entries(
			monthlyStats[monthKey].keywords
		).map(([keyword, count]) => ({
			name: keyword,
			value: count,
		}));

		// Format emojis for API
		monthlyStats[monthKey].emojisFormatted = monthlyStats[
			monthKey
		].topEmojis.map((item) => ({
			name: item.emoji,
			value: item.count,
		}));
	});

	return {
		chatName: chatData.name,
		chatId: chatData.id,
		totalMessages: chatData.messages.length,
		monthlyStats: monthlyStats,
	};
}

/**
 * Store analysis results in MongoDB Atlas
 * @param {Object} analysis - The analysis results
 */
async function storeAnalysisInMongoDB(analysis) {
	// Check if MONGO_URI is available
	if (!process.env.MONGO_URI) {
		console.error("MONGO_URI not found in environment variables");
		throw new Error("MongoDB connection string is missing");
	}

	let connection = null;

	try {
		// Connect to MongoDB Atlas
		connection = await mongoose.connect(process.env.MONGO_URI);

		console.log("Connected to MongoDB Atlas successfully");

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

		// Create or get models
		const ChatAnalysis =
			mongoose.models.ChatAnalysis ||
			mongoose.model("ChatAnalysis", ChatAnalysisSchema);

		// Convert monthly stats object to array for storage
		const monthlyStatsArray = Object.values(analysis.monthlyStats).map(
			(month) => ({
				month: month.month,
				messageCount: month.messageCount,
				photoCount: month.photoCount,
				keywords: month.keywords,
				keywordsFormatted: month.keywordsFormatted,
				emojisFormatted: month.emojisFormatted,
			})
		);

		// Upsert the data (update if exists, insert if not)
		const result = await ChatAnalysis.findOneAndUpdate(
			{ chatId: analysis.chatId },
			{
				chatName: analysis.chatName,
				totalMessages: analysis.totalMessages,
				lastUpdated: new Date(),
				monthlyStats: monthlyStatsArray,
			},
			{ upsert: true, new: true }
		);

		console.log("Analysis stored in MongoDB Atlas successfully");
		return result;
	} catch (error) {
		console.error("Error storing in MongoDB Atlas:", error);
		throw error;
	} finally {
		// Only close the connection if we're not in a persistent server environment
		if (require.main === module && connection) {
			console.log("Closing MongoDB connection");
			await mongoose.connection.close();
		}
	}
}

// If this script is run directly
if (require.main === module) {
	// Path to the JSON file (change as needed)
	const filePath = path.join(__dirname, "result.json");

	parseTelegramChat(filePath)
		.then(() => console.log("Parsing completed"))
		.catch((err) => console.error("Error:", err));
}

module.exports = { parseTelegramChat, analyzeChat };
