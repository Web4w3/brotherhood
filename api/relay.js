// Vercel serverless function handler - imports and exports the Express app
// Vercel will automatically call this as a serverless function
import dotenv from "dotenv";
import path from "path";

// Load environment variables first
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// Import and export the app from the compiled relay module
import app from "../dist/relay.js";
export default app;
