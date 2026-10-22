// The Citehound app for Pipedream components: the API key (an app auth field) and the one client every component uses (common/citehound-core.js, a copy of integrations/shared).
// Pipedream's runtime has fetch (Node 18+), which is what the client uses.
import core from "./common/citehound-core.js";

export default {
  type: "app",
  app: "citehound",
  propDefinitions: {
    domain: { type: "string", label: "Domain", description: "A bare domain such as example.com. A URL is cleaned to its domain." },
    eventTypes: {
      type: "string[]", label: "Event Types", optional: true,
      description: "Leave empty for all types.",
      options: ["score_dropped", "score_improved", "crawler_blocked", "crawler_unblocked", "llms_txt_added", "llms_txt_removed", "check_failed", "check_fixed", "scan_failed"],
    },
  },
  methods: {
    // The client for this account's key. this.fetchImpl is for tests.
    _core() {
      return core.createCore({ apiKey: this.$auth.api_key, fetch: this.fetchImpl || globalThis.fetch, platform: "pipedream", version: "0.1.0" });
    },
    // Runs an operation. A Citehound error becomes a plain Error with the API's own message (it names the plans, never the key).
    async run(op, params) {
      try { return await this._core().run(op, params); }
      catch (e) { throw new Error(e.message); }
    },
    async pollEvents(state, opts) {
      try { return await this._core().pollEvents(state, opts); }
      catch (e) { throw new Error(e.message); }
    },
  },
};
