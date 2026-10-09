// Application error with a client-facing status and code. Thrown by services; the HTTP
// error handler turns it into a JSON response, so services never depend on Express.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
