import { celebrate, Joi, Segments } from 'celebrate'
import { AuthedSessionData } from 'express-session'
import { StatusCodes } from 'http-status-codes'
import { err, ok } from 'neverthrow'

import { IEncryptedFormDocument } from 'src/types'

import { featureFlags } from '../../../../../shared/constants'
import {
  ErrorDto,
  FormPaymentsFieldV2,
  PaymentChannel,
  PaymentsProductUpdateDto,
  PaymentsUpdateDto,
} from '../../../../../shared/types'
import { createLoggerWithLabel } from '../../../config/logger'
import { createReqMeta } from '../../../utils/request'
import { getFormAfterPermissionChecks } from '../../auth/auth.service'
import * as AuthService from '../../auth/auth.service'
import { ControllerHandler } from '../../core/core.types'
import * as FeatureFlagService from '../../feature-flags/feature-flags.service'
import {
  getStripeOauthUrl,
  unlinkStripeAccountFromForm,
  validateAccount,
} from '../../payments/stripe.service'
import { checkFormIsEncryptMode } from '../../submission/encrypt-submission/encrypt-submission.service'
import { getPopulatedUserById } from '../../user/user.service'
import * as UserService from '../../user/user.service'

import { PaymentChannelNotFoundError } from './admin-form.errors'
import * as AdminFormService from './admin-form.service'
import { PermissionLevel } from './admin-form.types'
import { mapRouteError, verifyUserBetaflag } from './admin-form.utils'

const logger = createLoggerWithLabel(module)

/**
 * Handler for POST /:formId/stripe.
 * @security session
 *
 * @returns 200 with Stripe redirect URL to complete OAuth flow
 * @returns 401 when user is not logged in
 * @returns 403 when user does not have permissions to update the form
 * @returns 404 when form to update cannot be found
 * @returns 410 when form to update has been deleted
 * @returns 422 when id of user who is updating the form cannot be found
 * @returns 422 when the form to be updated is not an encrypt mode form
 * @returns 500 when database error occurs
 */
export const handleConnectAccount: ControllerHandler<{
  formId: string
}> = async (req, res) => {
  const { formId } = req.params
  const sessionUserId = (req.session as AuthedSessionData).user._id

  const logMeta = {
    action: 'handleConnectAccount',
    ...createReqMeta(req),
  }

  // If getFeatureFlag throws a DatabaseError, we want to log it, but respond
  // to the client as if the flag is not found.
  const featureFlagsListResult = await FeatureFlagService.getEnabledFlags()

  let featureFlagEnabled = false

  if (featureFlagsListResult.isErr()) {
    logger.error({
      message: 'Error occurred whilst retrieving enabled feature flags',
      meta: logMeta,
      error: featureFlagsListResult.error,
    })
  } else {
    featureFlagEnabled = featureFlagsListResult.value.includes(
      featureFlags.payment,
    )
  }

  // Step 1: Retrieve currently logged in user.
  return (
    getPopulatedUserById(sessionUserId)
      // Step 2: Check if user has 'payment' betaflag
      .andThen((user) =>
        featureFlagEnabled
          ? ok(user)
          : verifyUserBetaflag(user, featureFlags.payment),
      )
      .andThen((user) =>
        // Step 3: Retrieve form with write permission check.
        getFormAfterPermissionChecks({
          user,
          formId,
          level: PermissionLevel.Write,
        }),
      )
      // Step 4: Ensure that the form is encrypt mode.
      .andThen(checkFormIsEncryptMode)
      // Step 5: Get the auth URL and state, and pass the auth URL for redirection.
      .andThen(getStripeOauthUrl)
      .map(({ authUrl, state }) => {
        // Save the state for validation later on, to ensure the state has not been
        // tampered with.
        res.cookie('stripeState', state, { signed: true })
        return res.json({ authUrl })
      })
      .mapErr((error) => {
        logger.error({
          message: 'Error connecting admin form payment account',
          meta: logMeta,
          error,
        })

        const { statusCode, errorMessage } = mapRouteError(error)
        return res.status(statusCode).json({ message: errorMessage })
      })
  )
}

/**
 * Handler for DELETE /:formId/stripe.
 * @security session
 *
 * @returns 200 when Stripe credentials successfully deleted
 * @returns 401 when user is not logged in
 * @returns 403 when user does not have permissions to update the form
 * @returns 404 when form to update cannot be found
 * @returns 410 when form to update has been deleted
 * @returns 422 when id of user who is updating the form cannot be found
 * @returns 422 when the form to be updated is not an encrypt mode form
 * @returns 500 when database error occurs
 */
export const handleUnlinkAccount: ControllerHandler<{
  formId: string
}> = async (req, res) => {
  const { formId } = req.params
  const sessionUserId = (req.session as AuthedSessionData).user._id

  // Step 1: Retrieve currently logged in user.
  return (
    getPopulatedUserById(sessionUserId)
      .andThen((user) =>
        // Step 2: Retrieve form with write permission check.
        getFormAfterPermissionChecks({
          user,
          formId,
          level: PermissionLevel.Write,
        }),
      )
      // Step 3: Ensure that the form is encrypt mode.
      .andThen(checkFormIsEncryptMode)
      // Step 4: Remove the Stripe account details.
      .andThen(unlinkStripeAccountFromForm)
      .map(() => res.status(StatusCodes.OK).json({ message: 'Success' }))
      .mapErr((error) => {
        logger.error({
          message: 'Error unlinking admin form payment account',
          meta: {
            action: 'handleUnlinkAccount',
            ...createReqMeta(req),
          },
          error,
        })

        const { statusCode, errorMessage } = mapRouteError(error)
        return res.status(statusCode).json({ message: errorMessage })
      })
  )
}

/**
 * Handler for GET /:formId/stripe/validate.
 * @security session
 *
 * @returns 200 when Stripe credentials have been validated
 * @returns 401 when user is not logged in
 * @returns 403 when user does not have permissions to update the form
 * @returns 404 when form to update cannot be found
 * @returns 410 when form to update has been deleted
 * @returns 422 when id of user who is updating the form cannot be found
 * @returns 422 when the form to be updated is not an encrypt mode form
 * @returns 500 when database error occurs
 * @returns 502 when the connected Stripe credentials are invalid
 */
export const handleValidatePaymentAccount: ControllerHandler<{
  formId: string
}> = async (req, res) => {
  const { formId } = req.params
  const sessionUserId = (req.session as AuthedSessionData).user._id

  // Step 1: Retrieve currently logged in user.
  return (
    getPopulatedUserById(sessionUserId)
      .andThen((user) =>
        // Step 2: Retrieve form with write permission check.
        getFormAfterPermissionChecks({
          user,
          formId,
          level: PermissionLevel.Write,
        }),
      )
      // Step 3: Ensure that the form is encrypt mode.
      .andThen(checkFormIsEncryptMode)
      // Step 4: Validate the associated Stripe account.
      .andThen((form) =>
        validateAccount(form.payments_channel.target_account_id),
      )
      .map((account) => res.json({ account }))
      .mapErr((error) => {
        logger.error({
          message: 'Error validating account',
          meta: {
            action: 'handleValidatePaymentAccount',
            ...createReqMeta(req),
          },
          error,
        })

        const { statusCode, errorMessage } = mapRouteError(error)
        return res.status(statusCode).json({ message: errorMessage })
      })
  )
}

/**
 * Private handler for PUT /:formId/payment
 * NOTE: Exported for testing.
 * @precondition Must be preceded by request validation
 * @security session
 *
 * @returns 200 with updated payments
 * @returns 400 when updated payment amount is out of bounds
 * @returns 403 when current user does not have permissions to update the payments
 * @returns 404 when form cannot be found
 * @returns 410 when updating the payments for an archived form
 * @returns 422 when user in session cannot be retrieved from the database
 * @returns 500 when database error occurs
 */
export const _handleUpdatePayments: ControllerHandler<
  { formId: string },
  IEncryptedFormDocument['payments_field'] | ErrorDto,
  PaymentsUpdateDto
> = async (req, res) => {
  const { formId } = req.params
  const sessionUserId = (req.session as AuthedSessionData).user._id

  const logMeta = {
    action: '_handleUpdatePayments',
    ...createReqMeta(req),
    userId: sessionUserId,
    formId,
    body: req.body,
  }

  // If getFeatureFlag throws a DatabaseError, we want to log it, but respond
  // to the client as if the flag is not found.
  const featureFlagsListResult = await FeatureFlagService.getEnabledFlags()

  let featureFlagEnabled = false

  if (featureFlagsListResult.isErr()) {
    logger.error({
      message: 'Error occurred whilst retrieving enabled feature flags',
      meta: logMeta,
      error: featureFlagsListResult.error,
    })
  } else {
    featureFlagEnabled = featureFlagsListResult.value.includes(
      featureFlags.payment,
    )
  }

  // Step 1: Retrieve currently logged in user.
  return (
    UserService.getPopulatedUserById(sessionUserId)
      // Step 2: Check if user has 'payment' betaflag
      .andThen((user) =>
        featureFlagEnabled
          ? ok(user)
          : verifyUserBetaflag(user, featureFlags.payment),
      )
      .andThen((user) =>
        // Step 2: Retrieve form with write permission check.
        AuthService.getFormAfterPermissionChecks({
          user,
          formId,
          level: PermissionLevel.Write,
        }),
      )
      .andThen(checkFormIsEncryptMode)
      // Step 3: Check that the payment form has a stripe account connected
      .andThen((form) =>
        form.payments_channel.channel === PaymentChannel.Unconnected
          ? err(new PaymentChannelNotFoundError())
          : ok(form),
      )
      // Step 4: User has permissions, proceed to allow updating of start page
      .andThen(() => AdminFormService.updatePayments(formId, req.body))
      .map((updatedPayments) =>
        res.status(StatusCodes.OK).json(updatedPayments),
      )
      .mapErr((error) => {
        logger.error({
          message: 'Error occurred when updating payments',
          meta: logMeta,
          error,
        })
        const { errorMessage, statusCode } = mapRouteError(error)
        return res.status(statusCode).json({ message: errorMessage })
      })
  )
}

export const _handleUpdatePaymentsProduct: ControllerHandler<
  { formId: string },
  FormPaymentsFieldV2['products'] | ErrorDto,
  PaymentsProductUpdateDto
> = (req, res) => {
  const { formId } = req.params
  const sessionUserId = (req.session as AuthedSessionData).user._id

  // Step 1: Retrieve currently logged in user.
  return (
    UserService.getPopulatedUserById(sessionUserId)
      // Step 2: Check if user has 'payment' betaflag
      .andThen((user) => verifyUserBetaflag(user, 'payment'))
      .andThen((user) =>
        // Step 2: Retrieve form with write permission check.
        AuthService.getFormAfterPermissionChecks({
          user,
          formId,
          level: PermissionLevel.Write,
        }),
      )
      .andThen(checkFormIsEncryptMode)
      // Step 3: Check that the payment form has a stripe account connected
      .andThen((form) =>
        form.payments_channel.channel === PaymentChannel.Unconnected
          ? err(new PaymentChannelNotFoundError())
          : ok(form),
      )
      // Step 4: User has permissions, proceed to allow updating of start page
      .andThen(() => AdminFormService.updatePaymentsProduct(formId, req.body))
      .map((updatedPayments) =>
        res
          .status(StatusCodes.OK)
          .json((updatedPayments as FormPaymentsFieldV2).products),
      )
      .mapErr((error) => {
        logger.error({
          message: 'Error occurred when updating payments product',
          meta: {
            action: '_handleUpdatePaymentsProduct',
            ...createReqMeta(req),
            userId: sessionUserId,
            formId,
            body: req.body,
          },
          error,
        })
        const { errorMessage, statusCode } = mapRouteError(error)
        return res.status(statusCode).json({ message: errorMessage })
      })
  )
}

/**
 * Handler for PUT /:formId/payment
 */

const PositiveIntWhenEnabledElseAnyInt = Joi.when('enabled', {
  is: Joi.equal(true),
  then: Joi.number().integer().positive().required(),
  otherwise: Joi.number().integer(),
})

export const handleUpdatePayments = [
  celebrate({
    [Segments.BODY]: {
      // common fields
      enabled: Joi.boolean().required(),
      description: Joi.when('enabled', {
        is: Joi.equal(true),
        then: Joi.string().required(),
        otherwise: Joi.string().allow(''),
      }),

      // v1 fields
      amount_cents: Joi.when('version', {
        switch: [
          { is: 1, then: PositiveIntWhenEnabledElseAnyInt },
          { is: 2, then: Joi.any() },
        ],
      }),
      // end v1 fields

      version: Joi.number().required(),
      // v2 fields
      products_meta: Joi.when('version', {
        switch: [
          { is: 1, then: Joi.any() },
          {
            is: 2,
            then: {
              multi_product: Joi.bool().required(),
            },
          },
        ],
      }),

      products: Joi.when('version', {
        switch: [
          { is: 1, then: Joi.any() },
          {
            is: 2,
            then: Joi.any(),
          },
        ],
      }),
    },
  }),
  _handleUpdatePayments,
] as ControllerHandler[]

/**
 * Handler for PUT /:formId/payment/products
 */
export const handleUpdatePaymentsProduct = [
  // TODO: populate actual products
  // celebrate({
  //   [Segments.BODY]: {
  //     // v2 fields
  //     products: {} Joi.string().required(),
  //   },
  // }),
  _handleUpdatePaymentsProduct,
] as ControllerHandler[]
