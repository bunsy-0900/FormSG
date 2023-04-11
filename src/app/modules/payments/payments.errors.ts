import { ApplicationError } from '../core/core.errors'

export class InvalidPaymentAmountError extends ApplicationError {
  constructor(message = 'Invalid payment amount') {
    super(message)
  }
}

export class PaymentNotFoundError extends ApplicationError {
  constructor(message = 'Payment not found') {
    super(message)
  }
}

export class PaymentAlreadyConfirmedError extends ApplicationError {
  constructor(message = 'Payment has already been confirmed') {
    super(message)
  }
}

export class PaymentAccountInformationError extends ApplicationError {
  constructor(message = 'Missing payment account information') {
    super(message)
  }
}