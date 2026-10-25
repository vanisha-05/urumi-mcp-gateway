import Fastify from "fastify";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "urumi-mcp-gateway",
  };
});

const start = async () => {
  try {
    await app.listen({
      port: 3000,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();