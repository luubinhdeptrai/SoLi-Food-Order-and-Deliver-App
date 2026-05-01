import { Global, Module } from '@nestjs/common';
import { GeoService } from './geo.service';

/**
 * GeoModule
 *
 * @Global() — register once in AppModule; GeoService is then injectable
 * everywhere without each module explicitly importing GeoModule.
 */
@Global()
@Module({
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
