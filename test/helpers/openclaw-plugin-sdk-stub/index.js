// Test stub for `openclaw/plugin-sdk`.
//
// This path is referenced by the jiti `alias` option in the test suite as
// `openclaw/plugin-sdk`. jiti matches aliases by string prefix, so the alias
// also rewrites subpath specifiers (`openclaw/plugin-sdk/<sub>`) to
// `<this path>/<sub>`. Keeping this stub as a directory (instead of a single
// file) lets the SDK subpaths used by the plugin resolve during tests without
// editing every test file.
export function stringEnum(values) {
  return {
    type: "string",
    enum: Array.isArray(values) ? values : [],
  };
}
