export class IntegrationUnavailableError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'IntegrationUnavailableError';
    this.code = code;
    this.status = status;
  }
}
