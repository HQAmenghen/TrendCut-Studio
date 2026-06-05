import 'reflect-metadata';
import { existsSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { BffExceptionFilter } from './bff-exception.filter';
import { BffRequestGuard } from './bff-request.guard';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  const host = process.env.BFF_HOST || '0.0.0.0';
  const port = Number(process.env.BFF_PORT || 3002);
  const frontendDist = join(process.cwd(), 'frontend-dist');

  app.useGlobalGuards(app.get(BffRequestGuard));
  app.useGlobalFilters(new BffExceptionFilter());
  if (existsSync(frontendDist)) {
    app.useStaticAssets(frontendDist);
  }

  await app.listen(port, host);
  console.log(`TrendCut BFF listening on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start TrendCut BFF', error);
  process.exit(1);
});
