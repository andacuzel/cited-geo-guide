'use strict';
// A stand-in for the two runtime exports the nodes use, so the tests need no install. The nodes were compiled against the real n8n-workflow types (npm run build).
class NodeOperationError extends Error { constructor(node, message, opts) { super(message); this.name = 'NodeOperationError'; this.node = node; this.itemIndex = opts && opts.itemIndex; } }
module.exports = { NodeConnectionTypes: { Main: 'main' }, NodeOperationError };
