export abstract class Entity<T extends Entity<T>> {
  abstract equals(obj: T): boolean;
}
