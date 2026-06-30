/**
 * default-profiles.js — Pre-defined database for Site Profiles
 * 
 * Contains built-in CSS selector profiles for popular e-learning sites.
 * This acts as a fallback when the user hasn't defined a custom profile
 * via the Visual Element Picker.
 */

export const DEFAULT_PROFILES = {
  // Biarkan kosong agar AI Selector Auto-Discovery bisa berjalan untuk Oracle Academy
  // Contoh untuk Udemy
  "udemy.com": {
    content: ".curriculum-item-view--content--3ZBlL",
    question: ".mc-quiz-question--question-prompt--2_K9b",
    options: ".mc-quiz-answer--answer-label--3v_i3 input",
    submit: "[data-purpose='submit-answer-button']",
    next: "[data-purpose='go-to-next-button']"
  }
};
