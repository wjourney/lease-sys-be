import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import "dotenv/config";
import helmet from "helmet";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { setupSwagger } from "./config/swagger";
import { secret } from "./modules/auth/jwt.config";
async function main() {
  secret();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  setupSwagger(app);
  await app.listen(
    Number(process.env.PORT || 3001),
    process.env.HOST || "127.0.0.1",
  );
}
if (require.main === module) void main();
