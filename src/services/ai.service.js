"use strict";

/**
 * AI service — proxies to the FastAPI RAG backend on HuggingFace Spaces.
 *
 * Env var:
 *   HF_BASE_URL  — e.g. https://ekrash1234-github-deploy-token.hf.space
 *   HF_API_TOKEN — HuggingFace Bearer token (optional)
 *
 * Real endpoints used (no legacy /api/* routes):
 *   POST /verified/generate-quiz          VerifiedQuizRequest → VerifiedQuizResponse
 *   POST /verified/generate-paper/boards  VerifiedPaperRequest → VerifiedPaperResponse
 *   POST /unverified/generate-paper       UnverifiedPaperRequest → UnverifiedPaperResponse
 *   POST /unverified/upload-paper         multipart → UnverifiedUploadResponse
 *   GET  /unverified/classes              → UnverifiedClassesResponse { hierarchy }
 *
 * The three verified categories are: "Punjab Boards", "Cambridge", "Federal Boards".
 * Cambridge papers use the same /boards endpoint with category="Cambridge".
 *
 * All calls have static fallbacks so the API stays functional when the AI
 * service is cold-starting or unreachable.
 */

const axios = require("axios");
const FormData = require("form-data");
const logger = require("../config/logger");

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

const HF_BASE = (
  process.env.HF_BASE_URL || "https://ekrash1234-github-deploy-token.hf.space"
).replace(/\/$/, "");
const HF_TOKEN = process.env.HF_API_TOKEN;

// ---------------------------------------------------------------------------
// Core HTTP helpers
// ---------------------------------------------------------------------------

function buildHeaders(extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  if (HF_TOKEN) h["Authorization"] = `Bearer ${HF_TOKEN}`;
  return h;
}

async function postJson(path, data) {
  const url = `${HF_BASE}${path}`;
  const response = await axios.post(url, data, {
    headers: buildHeaders(),
    timeout: 90_000, // HF Spaces can be slow on cold start
  });
  return response.data;
}

async function getJson(path) {
  const url = `${HF_BASE}${path}`;
  const headers = {};
  if (HF_TOKEN) headers["Authorization"] = `Bearer ${HF_TOKEN}`;
  const response = await axios.get(url, { headers, timeout: 30_000 });
  return response.data;
}

// ---------------------------------------------------------------------------
// Verified Quiz
// ---------------------------------------------------------------------------

/**
 * Generate MCQs from the verified vector store.
 *
 * @param {object} params
 * @param {string|null} params.country     e.g. "Pakistan"
 * @param {string|null} params.category    "Punjab Boards" | "Cambridge" | "Federal Boards"
 * @param {string|null} params.class_name  e.g. "Class 10", "O Level"
 * @param {string|null} params.subject     e.g. "Physics"
 * @param {number}      params.number_of_mcqs  1–50 (default 10)
 * @param {string|null} params.preference  "Easy"|"Medium"|"Hard"|"Popular"|"Mixed"
 * @returns {{ mcqs: MCQItem[] }}
 */
async function generateVerifiedQuiz(params = {}) {
  const payload = {
    country: params.country ?? null,
    category: params.category ?? null,
    class: params.class_name ?? params.class ?? null,
    subject: params.subject ?? null,
    number_of_mcqs: params.number_of_mcqs ?? 10,
    preference: params.preference ?? null,
  };

  try {
    const data = await postJson("/verified/generate-quiz", payload);
    const mcqs = data.mcqs ?? [];
    if (!Array.isArray(mcqs) || mcqs.length === 0) {
      throw new Error("Empty mcqs array from AI");
    }
    logger.info(
      `ai: quiz generated subject="${params.subject}" category="${params.category}" (${mcqs.length} MCQs)`,
    );
    return { mcqs };
  } catch (err) {
    logger.warn(`ai: generateVerifiedQuiz failed — fallback: ${err.message}`);
    const subject = params.subject ?? "General";
    return {
      mcqs: [
        {
          id: 1,
          prompt: `Sample ${subject} question 1`,
          options: [
            { id: "A", label: "Option A" },
            { id: "B", label: "Option B" },
            { id: "C", label: "Option C" },
            { id: "D", label: "Option D" },
          ],
          answer: "A",
        },
        {
          id: 2,
          prompt: `Sample ${subject} question 2`,
          options: [
            { id: "A", label: "Option A" },
            { id: "B", label: "Option B" },
            { id: "C", label: "Option C" },
            { id: "D", label: "Option D" },
          ],
          answer: "B",
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Verified Paper (all three categories use /boards endpoint)
// ---------------------------------------------------------------------------

/**
 * Generate a verified exam paper.
 *
 * @param {object} params
 * @param {string}      params.class_name       e.g. "Class 10", "O Level"
 * @param {string}      params.subject          e.g. "Physics"
 * @param {string|null} params.country          e.g. "Pakistan"
 * @param {string|null} params.category         "Punjab Boards" | "Cambridge" | "Federal Boards"
 * @param {number}      params.mcqs             1–50 (default 10)
 * @param {number}      params.short_questions  0–30 (default 5)
 * @param {number}      params.long_questions   0–20 (default 3)
 * @param {string|null} params.preference       "Easy"|"Medium"|"Hard"|"Popular"|"Mixed"
 * @returns {VerifiedPaperResponse}
 */
async function generateVerifiedPaper(params) {
  const payload = {
    class: params.class_name ?? params.class ?? "",
    subject: params.subject ?? "",
    country: params.country ?? null,
    category: params.category ?? null,
    mcqs: params.mcqs ?? 10,
    short_questions: params.short_questions ?? 5,
    long_questions: params.long_questions ?? 3,
    preference: params.preference ?? null,
  };

  try {
    const data = await postJson("/verified/generate-paper/boards", payload);
    if (!data || typeof data !== "object")
      throw new Error("Invalid response from AI");
    logger.info(
      `ai: verified paper generated subject="${params.subject}" category="${params.category}"`,
    );
    return data;
  } catch (err) {
    logger.warn(`ai: generateVerifiedPaper failed — fallback: ${err.message}`);
    return {
      mcqs: [],
      short_questions: [],
      long_questions: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Unverified (community) paper
// ---------------------------------------------------------------------------

/**
 * Generate a community paper from unverified uploads.
 *
 * @param {object} params
 * @param {string}      params.country
 * @param {string|null} params.category   optional — from unverified hierarchy
 * @param {string}      params.class_name
 * @param {string}      params.subject
 * @param {number}      params.mcqs
 * @param {number}      params.short_questions
 * @param {number}      params.long_questions
 * @param {string|null} params.preference "Easy"|"Medium"|"Hard"|"Popular"|"Mixed"
 */
async function generateUnverifiedPaper(params) {
  const payload = {
    country: params.country ?? "",
    class: params.class_name ?? params.class ?? "",
    subject: params.subject ?? "",
    category: params.category ?? null,
    mcqs: params.mcqs ?? 10,
    short_questions: params.short_questions ?? 5,
    long_questions: params.long_questions ?? 3,
    preference: params.preference ?? null,
  };

  try {
    const data = await postJson("/unverified/generate-paper", payload);
    if (!data || typeof data !== "object")
      throw new Error("Invalid response from AI");
    logger.info(
      `ai: unverified paper generated country="${params.country}" category="${params.category}"`,
    );
    return data;
  } catch (err) {
    logger.warn(
      `ai: generateUnverifiedPaper failed — fallback: ${err.message}`,
    );
    return { mcqs: [], short_questions: [], long_questions: [] };
  }
}

/**
 * Get the metadata hierarchy from the unverified vector store.
 * Returns { hierarchy: { [country]: { [category]: { [class]: [subjects] } } } }
 */
async function getUnverifiedClasses() {
  try {
    const data = await getJson("/unverified/classes");
    return data; // { hierarchy: {...} }
  } catch (err) {
    logger.warn(`ai: getUnverifiedClasses failed — fallback: ${err.message}`);
    return { hierarchy: {} };
  }
}

// ---------------------------------------------------------------------------
// Upload scoring (community upload → unverified vector store)
// ---------------------------------------------------------------------------

/**
 * Upload a paper file to the unverified vector store for scoring.
 * Uses multipart/form-data — must receive a Buffer + filename.
 *
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {string} country
 * @param {string} className
 * @param {string} subject
 * @param {string} [category]
 * @returns {{ accepted: boolean, score: number, reason: string }}
 */
async function scoreUpload(
  fileBuffer,
  filename,
  country = "",
  className = "",
  subject = "",
  category = "",
) {
  try {
    const form = new FormData();
    form.append("file", fileBuffer, {
      filename,
      contentType: "application/pdf",
    });
    form.append("country", country);
    form.append("class", className);
    form.append("subject", subject);
    if (category) form.append("category", category);

    const url = `${HF_BASE}/unverified/upload-paper`;
    const headers = { ...form.getHeaders() };
    if (HF_TOKEN) headers["Authorization"] = `Bearer ${HF_TOKEN}`;

    const response = await axios.post(url, form, { headers, timeout: 120_000 });
    const data = response.data;

    const accepted = Boolean(data.accepted);
    const ai_score = typeof data.score === "number" ? data.score : 0;
    // AI returns score 0–10; reward_tokens mirrors the score directly (max 10 COIN)
    const reward_tokens = accepted
      ? Math.min(Math.max(Math.round(ai_score), 0), 10)
      : 0;

    logger.info(
      `ai: scoreUpload filename="${filename}" accepted=${accepted} score=${ai_score} reward=${reward_tokens}`,
    );
    return { accepted, ai_score, reward_tokens, reason: data.reason ?? "" };
  } catch (err) {
    logger.warn(`ai: scoreUpload failed — fallback: ${err.message}`);
    return {
      accepted: false,
      ai_score: 0,
      reward_tokens: 0,
      reason: "Upload scoring unavailable",
    };
  }
}

module.exports = {
  generateVerifiedQuiz,
  generateVerifiedPaper,
  generateUnverifiedPaper,
  getUnverifiedClasses,
  scoreUpload,
  // Legacy aliases kept so existing callers don't break during transition
  generateCambridgePaper: (p) =>
    generateVerifiedPaper({ ...p, category: "Cambridge" }),
  generateBoardsPaper: (p) =>
    generateVerifiedPaper({ ...p, category: "Punjab Boards" }),
  generatePaper: (subject, format) =>
    generateVerifiedPaper({
      subject,
      category: format === "cambridge" ? "Cambridge" : "Punjab Boards",
    }),
};
