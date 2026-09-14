"use strict";

// Vercel Node.js entrypoint. OpenAI Responses + Web Search call is in
// lib/research.js::researchWeb; HTTP validation and cache live in the handler.
const { createSearchHandler } = require("../lib/search-handler");
module.exports = createSearchHandler();
