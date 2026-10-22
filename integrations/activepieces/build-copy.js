// After tsc: copies the shared client next to the compiled piece.
const fs = require('fs'), path = require('path');
fs.copyFileSync(path.join(__dirname, 'src/lib/citehound-core.js'), path.join(__dirname, 'dist/src/lib/citehound-core.js'));
