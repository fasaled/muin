export class MuinError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class UsageError extends MuinError {
  constructor(message: string) {
    super("usage", message);
  }
}

export class EncryptedPdfError extends MuinError {
  constructor(message = "this PDF is encrypted; Muin cannot open encrypted files") {
    super("encrypted", message);
  }
}

export class CorruptPdfError extends MuinError {
  constructor(message: string) {
    super("corrupt", message);
  }
}

export class LimitError extends MuinError {
  constructor(message: string) {
    super("limit", message);
  }
}

export class NotFoundError extends MuinError {
  constructor(message: string) {
    super("not_found", message);
  }
}
