import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZonesRepository } from './zones.repository';
import { RestaurantService } from '../restaurant.service';
import { GeoService, type Coordinates } from '@/lib/geo/geo.service';
import type {
  CreateDeliveryZoneDto,
  UpdateDeliveryZoneDto,
  DeliveryEstimateResponseDto,
  DeliveryFeeBreakdownDto,
} from './zones.dto';
import type { DeliveryZone } from '@/module/restaurant-catalog/restaurant/restaurant.schema';

@Injectable()
export class ZonesService {
  constructor(
    private readonly repo: ZonesRepository,
    private readonly restaurantService: RestaurantService,
    private readonly geo: GeoService,
  ) {}

  async findByRestaurant(restaurantId: string): Promise<DeliveryZone[]> {
    await this.restaurantService.findOne(restaurantId);
    return this.repo.findByRestaurant(restaurantId);
  }

  async findOne(id: string, restaurantId: string): Promise<DeliveryZone> {
    const zone = await this.repo.findById(id);
    if (!zone || zone.restaurantId !== restaurantId) {
      throw new NotFoundException('Delivery zone not found');
    }
    return zone;
  }

  async create(
    restaurantId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: CreateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.create(restaurantId, dto);
  }

  async update(
    id: string,
    restaurantId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    await this.findOne(id, restaurantId);
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.update(id, dto);
  }

  async remove(
    id: string,
    restaurantId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    await this.findOne(id, restaurantId);
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Delivery estimate
  // ---------------------------------------------------------------------------

  /**
   * Calculates the delivery fee and estimated arrival time for a customer's
   * coordinates against the restaurant's active delivery zones.
   *
   * Throws:
   *  - 404 if restaurant not found
   *  - 422 if the restaurant has no geo coordinates configured
   *  - 422 if no active delivery zones exist
   *  - 422 if the customer is outside all delivery zones
   */
  async estimateDelivery(
    restaurantId: string,
    customerCoords: Coordinates,
  ): Promise<DeliveryEstimateResponseDto> {
    const restaurant = await this.restaurantService.findOne(restaurantId);

    if (restaurant.latitude == null || restaurant.longitude == null) {
      throw new UnprocessableEntityException(
        'This restaurant has not configured its location yet.',
      );
    }

    const restaurantCoords: Coordinates = {
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    };

    const activeZones =
      await this.repo.findActiveByRestaurantOrderedByRadius(restaurantId);

    if (activeZones.length === 0) {
      throw new UnprocessableEntityException(
        'This restaurant has no active delivery zones.',
      );
    }

    const distanceKm = this.geo.calculateDistanceKm(
      restaurantCoords,
      customerCoords,
    );

    const eligibleZone = this.findEligibleZone(activeZones, distanceKm);
    if (!eligibleZone) {
      throw new UnprocessableEntityException(
        `Your location is ${distanceKm.toFixed(1)} km from the restaurant, which is outside all delivery zones.`,
      );
    }

    return this.buildEstimateResponse(restaurantId, distanceKm, eligibleZone);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the innermost zone whose radius covers the given distance.
   * Zones are pre-sorted by radiusKm ASC from the repository.
   */
  private findEligibleZone(
    activeZones: DeliveryZone[],
    distanceKm: number,
  ): DeliveryZone | undefined {
    return activeZones.find((zone) => zone.radiusKm >= distanceKm);
  }

  private calculateDeliveryFee(zone: DeliveryZone, distanceKm: number): number {
    return zone.baseFee + distanceKm * zone.perKmRate;
  }

  private calculateEstimatedMinutes(
    zone: DeliveryZone,
    distanceKm: number,
  ): number {
    const travelTimeMinutes = Math.ceil((distanceKm / zone.avgSpeedKmh) * 60);
    return zone.prepTimeMinutes + travelTimeMinutes + zone.bufferMinutes;
  }

  private buildEstimateResponse(
    restaurantId: string,
    distanceKm: number,
    zone: DeliveryZone,
  ): DeliveryEstimateResponseDto {
    const deliveryFee = this.calculateDeliveryFee(zone, distanceKm);
    const distanceFee = distanceKm * zone.perKmRate;
    const travelTimeMinutes = Math.ceil((distanceKm / zone.avgSpeedKmh) * 60);
    const estimatedMinutes = this.calculateEstimatedMinutes(zone, distanceKm);

    const breakdown: DeliveryFeeBreakdownDto = {
      baseFee: zone.baseFee,
      distanceFee: Math.round(distanceFee),
      prepTimeMinutes: zone.prepTimeMinutes,
      travelTimeMinutes,
      bufferMinutes: zone.bufferMinutes,
    };

    return {
      restaurantId,
      // Round to 2 dp for display — sub-metre precision is meaningless for delivery.
      distanceKm: Math.round(distanceKm * 100) / 100,
      zone: { id: zone.id, name: zone.name, radiusKm: zone.radiusKm },
      // Round to whole VND — fractional currency units are not used in Vietnam.
      deliveryFee: Math.round(deliveryFee),
      // Round to whole minutes — fractional ETA confuses customers.
      estimatedMinutes: Math.round(estimatedMinutes),
      breakdown,
    };
  }
}

