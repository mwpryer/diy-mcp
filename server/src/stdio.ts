import readline from "node:readline";
import { stdin, stdout } from "node:process";

export const lines = readline.createInterface({
  input: stdin,
  output: stdout,
});

export function sendResponse(id: number, result: object) {
  const response = {
    jsonrpc: "2.0",
    id,
    result,
  };
  console.log(JSON.stringify(response));
}

export function sendError(id: number, code: number, message: string) {
  const response = {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
  console.log(JSON.stringify(response));
}
