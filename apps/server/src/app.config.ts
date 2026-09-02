import { defineRoom, defineServer } from "colyseus";
import { PRIVATE_RACE_ROOM } from "@game-moto/protocol";
import { getServerConfig } from "./config";
import { createHealthPayload } from "./health";
import { PrivateRaceRoom } from "./rooms/PrivateRaceRoom";

interface HttpRequest {
  method: string;
}

interface HttpResponse {
  header(name: string, value: string): void;
  sendStatus(statusCode: number): unknown;
  status(statusCode: number): { json(body: unknown): unknown };
}

type Next = () => void;

type HttpHandler = (request: HttpRequest, response: HttpResponse, next: Next) => unknown;

interface HttpApp {
  disable(setting: string): unknown;
  use(handler: HttpHandler): unknown;
  get(path: string, handler: HttpHandler): unknown;
}

const config = getServerConfig();

export const gameServer = defineServer({
  rooms: {
    [PRIVATE_RACE_ROOM]: defineRoom(PrivateRaceRoom),
  },
  express: (app: HttpApp) => {
    app.disable("x-powered-by");
    app.use((request: HttpRequest, response: HttpResponse, next: Next) => {
      response.header("Access-Control-Allow-Origin", config.allowedOrigin);
      response.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      response.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      if (request.method === "OPTIONS") return response.sendStatus(204);
      next();
    });
    app.get("/health", (_request: HttpRequest, response: HttpResponse) =>
      response.status(200).json(createHealthPayload()),
    );
  },
});
