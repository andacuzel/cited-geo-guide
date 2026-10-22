import citehound from "../../citehound.app.mjs";

export default {
  key: "citehound-watch-domain",
  name: "Watch a Domain",
  description: "Adds a domain to the watchlist. Needs a Pro, Fix or Beyond key.",
  version: "0.1.0",
  type: "action",
  props: {
    citehound,
    domain: { propDefinition: [citehound, "domain"] },
    alertEmail: { type: "string", label: "Alert Email", optional: true, description: "The address the key was sent to, to get alert emails." },
  },
  async run({ $ }) {
    const result = await this.citehound.run("watchAdd", { domain: this.domain, alert_email: this.alertEmail });
    $.export("$summary", "Watch a Domain: done");
    return result;
  },
};
