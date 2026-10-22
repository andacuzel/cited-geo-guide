import citehound from "../../citehound.app.mjs";

export default {
  key: "citehound-new-event",
  name: "New Monitoring Event",
  description: "Emits an event when something changes on a domain you watch: a score drop or rise, a crawler blocked or unblocked, llms.txt added or removed, a check failing or fixed, a scan that failed. Needs a Pro, Fix or Beyond key.",
  version: "0.1.0",
  type: "source",
  dedupe: "unique",
  props: {
    citehound,
    db: "$.service.db",
    timer: { type: "$.interface.timer", default: { intervalSeconds: 60 * 15 } },
    domain: { type: "string", label: "Domain", optional: true, description: "Leave empty for all watched domains." },
    eventTypes: { propDefinition: [citehound, "eventTypes"] },
  },
  methods: {
    emitEvent(e) { this.$emit(e, { id: e.id, summary: e.summary, ts: Date.parse(e.at) }); },
  },
  hooks: {
    // On deploy: remember the newest event and send the latest few so the source shows something in the test tab.
    async deploy() {
      const r = await this.citehound.pollEvents({}, { domain: this.domain || undefined, types: this.eventTypes, firstRun: "latest" });
      this.db.set("lastId", r.state.lastId);
      r.events.forEach((e) => this.emitEvent(e));
    },
  },
  async run() {
    const r = await this.citehound.pollEvents({ lastId: this.db.get("lastId") }, { domain: this.domain || undefined, types: this.eventTypes });
    if (r.state.lastId) this.db.set("lastId", r.state.lastId);
    r.events.forEach((e) => this.emitEvent(e));
  },
};
