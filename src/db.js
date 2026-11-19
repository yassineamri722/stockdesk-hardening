// Minimal "database" layer for the exercise: no driver, no dependency.
// checkDatabase() only tells whether the PostgreSQL host accepts a TCP connection.
const net = require("net");

function checkDatabase(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

module.exports = { checkDatabase };
