// After tsc: copies the files tsc does not (the core client and the icon) next to the compiled nodes.
const fs = require('fs'), path = require('path');
fs.copyFileSync(path.join(__dirname, 'citehound-core.js'), path.join(__dirname, 'dist/nodes/Citehound/citehound-core.js'));
fs.copyFileSync(path.join(__dirname, 'nodes/Citehound/citehound.svg'), path.join(__dirname, 'dist/nodes/Citehound/citehound.svg'));
