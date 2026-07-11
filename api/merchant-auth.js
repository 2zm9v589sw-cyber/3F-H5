const { handler } = require("../netlify/functions/merchant-auth");
const { runNetlifyHandler } = require("./_netlify-adapter");

module.exports = (req, res) => runNetlifyHandler(handler, req, res);
