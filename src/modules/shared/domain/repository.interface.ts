export interface Repository<T, TId> {
  findById(id: TId): Promise<T | null>;
  save(entity: T): Promise<void>;
}
