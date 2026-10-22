import citehound from "../../citehound.app.mjs";

export default {
  key: "citehound-get-fix-list",
  name: "Get the Fix List",
  description: "The prioritized fix list with the files to paste. Needs a Fix or Beyond key.",
  version: "0.1.0",
  type: "action",
  props: {
    citehound,
    domain: { propDefinition: [citehound, "domain"] },
  },
  async run({ $ }) {
    const result = await this.citehound.run("fixes", { domain: this.domain });
    $.export("$summary", "Get the Fix List: done");
    return result;
  },
};
