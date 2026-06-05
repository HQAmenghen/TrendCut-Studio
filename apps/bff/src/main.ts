import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const host = process.env.BFF_HOST || '0.0.0.0';
  const port = Number(process.env.BFF_PORT || 3002);

  await app.listen(port, host);
  console.log(`TrendCut BFF listening on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start TrendCut BFF', error);
  process.exit(1);
});
