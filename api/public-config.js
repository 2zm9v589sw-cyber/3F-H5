const { handler } = require("../netlify/functions/public-config");
const { runNetlifyHandler } = require("./_netlify-adapter");

module.exports = (req, res) => runNetlifyHandler(handler, req, res);
