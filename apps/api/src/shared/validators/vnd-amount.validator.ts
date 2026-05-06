import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validates that a value is a valid VND monetary amount:
 *   - Must be an integer
 *   - Must be a multiple of 1000
 *   - Must be >= 1000 (use @IsVNDFee for fees that allow 0)
 *
 * VND has no sub-unit and merchants price in increments of 1000 VND.
 */
@ValidatorConstraint({ name: 'isVNDAmount', async: false })
export class IsVNDAmountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1000 &&
      value % 1000 === 0
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Price must be a positive integer multiple of 1000 VND (minimum 1000)';
  }
}

/**
 * Validates that a fee value is a valid VND amount that may be zero:
 *   - Must be an integer
 *   - Must be a multiple of 1000
 *   - May be 0 (free delivery, no surcharge)
 */
@ValidatorConstraint({ name: 'isVNDFee', async: false })
export class IsVNDFeeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value % 1000 === 0
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Fee must be a non-negative integer multiple of 1000 VND';
  }
}

/**
 * Decorator: validates that the price is an integer multiple of 1000 VND, minimum 1000.
 * Apply to menu item prices and any field where 0 is invalid.
 */
export function IsVNDAmount(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsVNDAmountConstraint,
    });
  };
}

/**
 * Decorator: validates that the fee is an integer multiple of 1000 VND (0 allowed).
 * Apply to delivery zone baseFee, perKmRate, and modifier option prices.
 */
export function IsVNDFee(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsVNDFeeConstraint,
    });
  };
}
