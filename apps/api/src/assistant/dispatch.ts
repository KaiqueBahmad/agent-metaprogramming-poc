import { Duplex } from "node:stream";
import { Server } from "node:http";

// O marcador pertence ao socket criado pelo executor; headers externos não o definem.
export const agentSockets = new WeakSet<object>();

export function dispatchAgent(
  server: Server,
  path: string,
  options: {
    method: "GET" | "POST";
    body?: unknown;
    token: string;
    companyId: number;
  }
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Tempo limite na execução da ferramenta."));
    }, 15000);
    const socket = new Duplex({
      allowHalfOpen: true,
      read() {},
      write(chunk, _encoding, callback) {
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
        } catch (error) {
          reject(error);
        }
        callback();
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    agentSockets.add(socket);
    const payload =
      options.body === undefined ? "" : JSON.stringify(options.body);
    const headers = [
      `${options.method} ${path} HTTP/1.1`,
      "Host: localhost",
      "Connection: close",
      `Authorization: Bearer ${options.token}`,
      `X-Company-Id: ${options.companyId}`
    ];
    if (options.body !== undefined)
      headers.push(
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(payload)}`
      );
    server.emit("connection", socket);
    socket.push(Buffer.from(`${headers.join("\r\n")}\r\n\r\n${payload}`));
  });
}
