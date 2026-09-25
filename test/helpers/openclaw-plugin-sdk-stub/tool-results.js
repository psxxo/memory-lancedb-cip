// Test stub for `openclaw/plugin-sdk/tool-results`.
//
// Mirrors the host implementation exactly (OpenClaw 2026.9.5,
// dist/plugin-sdk/tool-results.js) so tool results built through the official
// constructors keep their documented shape under the test harness.
export function textResult(text, details) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function jsonResult(payload) {
  return textResult(JSON.stringify(payload, null, 2), payload);
}
