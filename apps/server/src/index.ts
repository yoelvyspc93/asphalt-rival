import { getServerConfig } from "./config";
import { gameServer } from "./app.config";

const config = getServerConfig();

try {
  await gameServer.listen(config.port, config.host);
  console.info(`Servidor autoritativo escuchando en http://${config.host}:${config.port}`);
} catch (error) {
  console.error("No se pudo iniciar el servidor autoritativo.", error);
  process.exitCode = 1;
}
