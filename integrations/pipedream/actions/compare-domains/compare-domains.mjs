import citehound from "../../citehound.app.mjs";

export default {
  key: "citehound-compare-domains",
  name: "Compare Two Domains",
  description: "Scans two domains and lists where they differ. Needs a Pro, Fix or Beyond key.",
  version: "0.1.0",
  type: "action",
  props: {
    citehound,
    a: { type: "string", label: "First Domain" },
    b: { type: "string", label: "Second Domain" },
  },
  async run({ $ }) {
    const result = await this.citehound.run("compare", { a: this.a, b: this.b });
    $.export("$summary", "Compare Two Domains: done");
    return result;
  },
};
