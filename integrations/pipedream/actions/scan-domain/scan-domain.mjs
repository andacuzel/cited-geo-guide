import citehound from "../../citehound.app.mjs";

export default {
  key: "citehound-scan-domain",
  name: "Scan a Domain",
  description: "Scans a domain for AI readiness: the score, the pillars, the crawlers and the failed checks. A free key shows the first three findings.",
  version: "0.1.0",
  type: "action",
  props: {
    citehound,
    domain: { propDefinition: [citehound, "domain"] },
  },
  async run({ $ }) {
    const result = await this.citehound.run("scan", { domain: this.domain });
    $.export("$summary", "Scan a Domain: done");
    return result;
  },
};
