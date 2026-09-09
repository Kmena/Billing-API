export abstract class BaseEntity<TId> {
  protected readonly _id: TId;
  readonly createdAt: Date;
  updatedAt: Date;

  constructor(id: TId, createdAt?: Date, updatedAt?: Date) {
    this._id = id;
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }

  get id(): TId {
    return this._id;
  }

  equals(other: BaseEntity<TId>): boolean {
    if (other === null || other === undefined) return false;
    if (!(other instanceof BaseEntity)) return false;
    return JSON.stringify(this._id) === JSON.stringify(other._id);
  }
}
