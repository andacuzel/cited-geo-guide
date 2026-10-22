'use strict';
// A stand-in for the builders of @activepieces/pieces-framework, so the tests need no install. The piece was compiled against the real package's types (npm run build).
const prop = (type) => (x) => Object.assign({ type: type }, x);
module.exports = {
  createPiece: (x) => x, createAction: (x) => x, createTrigger: (x) => x,
  PieceAuth: { SecretText: prop('SECRET_TEXT') },
  Property: { ShortText: prop('SHORT_TEXT'), Array: prop('ARRAY'), StaticDropdown: prop('STATIC_DROPDOWN'), StaticMultiSelectDropdown: prop('STATIC_MULTI_SELECT_DROPDOWN') },
  TriggerStrategy: { POLLING: 'POLLING', WEBHOOK: 'WEBHOOK' },
};
