export abstract class ValueObject<T extends ValueObject<T>> {
  abstract equals(obj: T): boolean;
}
