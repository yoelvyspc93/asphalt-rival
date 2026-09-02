import { defineRoom, defineServer } from "colyseus";
import { PRIVATE_RACE_ROOM } from "@game-moto/protocol";
import { getServerConfig } from "./config";
import { createHealthPayload } from "./health";
import { PrivateRaceRoom } from "./rooms/PrivateRaceRoom";

const config = getServerConfig();

export const gameServer = defineServer({
  rooms: {
    [PRIVATE_RACE_ROOM]: defineRoom(PrivateRaceRoom),
  },
  express: (app) => {
    app.disable("x-powered-by");
    app.use((request, response, next) => {
      response.header("Access-Control-Allow-Origin", config.allowedOrigin);
      response.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      response.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      if (request.method === "OPTIONS") return response.sendStatus(204);
      next();
    });
    app.get("/health", (_request, response) => response.status(200).json(createHealthPayload()));
  },
});

