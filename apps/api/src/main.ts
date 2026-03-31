import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import { auth } from './lib/auth';
import { AppModule } from './app.module';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('api');
  const config = new DocumentBuilder()
    .setTitle('API')
    .setDescription('API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const nestDoc = SwaggerModule.createDocument(app, config);
  const betterAuthDoc = await (
    auth.api.generateOpenAPISchema() as Promise<Partial<OpenAPIObject>>
  ).catch((): Partial<OpenAPIObject> => ({ paths: {}, components: {} }));
  const prefixedAuthPaths = Object.fromEntries(
    Object.entries(betterAuthDoc.paths ?? {}).map(([path, value]) => [
      `/api/auth${path}`,
      value,
    ]),
  );
  const mergedDoc = {
    ...nestDoc,
    paths: {
      ...nestDoc.paths,
      ...(prefixedAuthPaths ?? {}),
    },
    components: {
      ...nestDoc.components,
      schemas: {
        ...nestDoc.components?.schemas,
        ...(betterAuthDoc.components?.schemas ?? {}),
      },
      securitySchemes: {
        ...nestDoc.components?.securitySchemes,
        ...(betterAuthDoc.components?.securitySchemes ?? {}),
      },
    },
    tags: [...(nestDoc.tags ?? []), ...(betterAuthDoc.tags ?? [])],
  };

  app.use('/api-spec.json', (_req: Request, res: Response) => {
    res.json(mergedDoc);
  });

  app.use(
    '/docs',
    apiReference({
      url: '/api-spec.json',
      theme: 'default', // 'default' | 'moon' | 'purple' | 'solarized' etc.
      layout: 'modern',
    }),
  );

  await app.listen(3000);
}

bootstrap();
