export abstract class DomainException extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain for ES5 target compatibility
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
