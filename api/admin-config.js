const { handler } = require("../netlify/functions/admin-config");
const { runNetlifyHandler } = require("./_netlify-adapter");

module.exports = (req, res) => runNetlifyHandler(handler, req, res);
