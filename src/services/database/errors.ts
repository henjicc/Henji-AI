/**
 * Database Error Types
 *
 * Custom error classes for database operations
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: DynamicValue
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

