// Dynamic layer over app.json: the store version always follows package.json,
// so `npm version` + tag is the single source of truth (see docs/release.md).
const { version } = require('./package.json');

module.exports = ({ config }) => ({ ...config, version });
