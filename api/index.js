// Vercel serverless function entry point
// Wraps the Express app with error handling for diagnostics
let app;
try {
  app = require("../server");
} catch (e) {
  // If server fails to initialize, return diagnostic error
  app = (req, res) => {
    res.status(500).json({
      error: "Server initialization failed",
      message: e.message,
      stack: e.stack
    });
  };
}

module.exports = app;
