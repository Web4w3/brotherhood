// Vercel entry point - use pre-built relay.js which has everything bundled
require("dotenv").config({ path: require("path").join(process.cwd(), ".env.local") });

const relay = require("./dist/relay.js");

// relay.js exports the Express app as default (or module.exports)
// For Vercel, we need to export it as a serverless function
module.exports = relay;

// Only listen locally (not in Vercel)
if (process.env.VERCEL !== "1" && !module.parent) {
  // If this is being run directly (not imported), the relay.js will handle the listen() call
}
