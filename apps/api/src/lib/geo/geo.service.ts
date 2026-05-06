import { Injectable } from '@nestjs/common';

const EARTH_RADIUS_KM = 6_371;
const DEGREES_TO_RADIANS = Math.PI / 180;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * GeoService
 *
 * Pure Haversine geometry utilities — no external dependencies.
 * Registered as @Global() via GeoModule so any module can inject it without
 * explicitly importing GeoModule.
 */
@Injectable()
export class GeoService {
  /**
   * Returns the great-circle distance between two coordinates in kilometres
   * using the Haversine formula.
   *
   * Error margin: ±0.1 km at typical food-delivery distances (< 20 km).
   */
  calculateDistanceKm(from: Coordinates, to: Coordinates): number {
    const fromLatRad = from.latitude * DEGREES_TO_RADIANS;
    const toLatRad = to.latitude * DEGREES_TO_RADIANS;
    const deltaLatRad = (to.latitude - from.latitude) * DEGREES_TO_RADIANS;
    const deltaLonRad = (to.longitude - from.longitude) * DEGREES_TO_RADIANS;

    const sinHalfDeltaLat = Math.sin(deltaLatRad / 2);
    const sinHalfDeltaLon = Math.sin(deltaLonRad / 2);

    const haversineAngle =
      sinHalfDeltaLat * sinHalfDeltaLat +
      Math.cos(fromLatRad) *
        Math.cos(toLatRad) *
        sinHalfDeltaLon *
        sinHalfDeltaLon;

    const centralAngle = 2 * Math.asin(Math.sqrt(haversineAngle));
    return EARTH_RADIUS_KM * centralAngle;
  }

  /**
   * Returns true if the destination is within `radiusKm` of the origin.
   */
  isWithinRadius(
    origin: Coordinates,
    destination: Coordinates,
    radiusKm: number,
  ): boolean {
    return this.calculateDistanceKm(origin, destination) <= radiusKm;
  }
}
