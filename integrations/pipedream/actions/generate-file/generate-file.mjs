import citehound from "../../citehound.app.mjs";

const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

export default {
  key: "citehound-generate-file",
  name: "Generate llms.txt, robots.txt or Schema",
  description: "Builds an llms.txt, a robots.txt for AI crawlers, or JSON-LD from a homepage. A free key gets a preview of the two files and the organization schema type; the full files and the other schema types need a Pro, Fix or Beyond key.",
  version: "0.1.0",
  type: "action",
  props: {
    citehound,
    kind: { type: "string", label: "File", options: ["llms.txt", "robots.txt", "schema"] },
    domain: { type: "string", label: "Domain", optional: true, description: "For schema." },
    schemaType: { type: "string", label: "Schema Type", optional: true, options: ["organization", "faqpage", "article", "product", "localbusiness"], default: "organization" },
    name: { type: "string", label: "Site Name", optional: true, description: "For llms.txt." },
    description: { type: "string", label: "Description", optional: true, description: "For llms.txt: one sentence." },
    pages: { type: "string[]", label: "Key Pages", optional: true, description: "For llms.txt, one per item: https://example.com/pricing | Plans and prices" },
    allow: { type: "string", label: "Allow", optional: true, description: "For robots.txt: comma-separated crawler names." },
    block: { type: "string", label: "Block", optional: true, description: "For robots.txt: comma-separated crawler names." },
    sitemap: { type: "string", label: "Sitemap URL", optional: true },
  },
  async run({ $ }) {
    let result;
    if (this.kind === "schema") result = await this.citehound.run("schema", { domain: this.domain, type: this.schemaType || "organization" });
    else if (this.kind === "robots.txt") result = await this.citehound.run("robotsTxt", { allow: list(this.allow), block: list(this.block), sitemap: this.sitemap });
    else {
      const pages = (this.pages || []).map((l) => { const i = l.indexOf("|"); return { url: l.slice(0, i === -1 ? undefined : i).trim(), description: i === -1 ? "" : l.slice(i + 1).trim() }; });
      result = await this.citehound.run("llmsTxt", { name: this.name, description: this.description, pages });
    }
    $.export("$summary", "Generated " + this.kind);
    return result;
  },
};
