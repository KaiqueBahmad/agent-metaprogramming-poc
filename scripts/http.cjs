const { Duplex } = require("node:stream");
function dispatch(app, path, { method = "GET", body, token, companyId } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout: ${method} ${path}`));
    }, 240000);
    const socket = new Duplex({
      allowHalfOpen: true,
      read() {},
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final(callback) {
        clearTimeout(timeout);
        try {
          const response = Buffer.concat(chunks).toString();
          const split = response.indexOf("\r\n\r\n");
          resolve({
            status: Number(response.split(" ")[1]),
            body: JSON.parse(response.slice(split + 4))
          });
        } catch (e) {
          reject(e);
        }
        callback();
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers = [
      `${method} ${path} HTTP/1.1`,
      "Host: localhost",
      "Connection: close"
    ];
    if (token) headers.push(`Authorization: Bearer ${token}`);
    if (companyId) headers.push(`X-Company-Id: ${companyId}`);
    if (body !== undefined)
      headers.push(
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(payload)}`
      );
    app.getHttpServer().emit("connection", socket);
    socket.push(Buffer.from(`${headers.join("\r\n")}\r\n\r\n${payload}`));
  });
}

module.exports = { dispatch };
