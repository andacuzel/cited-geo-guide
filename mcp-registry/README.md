# MCP Registry listing

`server.json` describes Citehound's remote MCP server for the official MCP Registry (registry.modelcontextprotocol.io): one Streamable HTTP remote, `https://getcitehound.com/api/mcp`, no authentication, 13 read-only tools.

Validate and publish with the `mcp-publisher` CLI, from this folder (it signs in with GitHub, so the name stays under `io.github.andacuzel/`):

    mcp-publisher validate
    mcp-publisher login github
    mcp-publisher publish

Raise `version` for every new publish. The text of the listing is the description in `server.json` (100 characters at most); it says nothing the `/claude` page does not.
