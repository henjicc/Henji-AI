/**
 * Database Error Types
 *
 * Custom error classes for database operations
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: any
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export class DatabaseNotInitializedError extends DatabaseError {
  constructor() {
    super('Database not initialized', 'DB_NOT_INITIALIZED')
  }
}

export class DatabaseQueryError extends DatabaseError {
  constructor(query: string, originalError: any) {
    super(
      `Query execution failed: ${query}`,
      'DB_QUERY_ERROR',
      originalError
    )
  }
}

export class DatabaseConstraintError extends DatabaseError {
  constructor(constraint: string, originalError: any) {
    super(
      `Constraint violation: ${constraint}`,
      'DB_CONSTRAINT_ERROR',
      originalError
    )
  }
}

export class DatabaseConnectionError extends DatabaseError {
  constructor(originalError: any) {
    super(
      'Failed to connect to database',
      'DB_CONNECTION_ERROR',
      originalError
    )
  }
}
