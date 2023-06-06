import { Router } from 'express'

import { rateLimitConfig } from '../../../../../../config/config'
import { authenticateApiKey } from '../../../../../../modules/auth/auth.middlewares'
import * as AdminFormController from '../../../../../../modules/form/admin-form/admin-form.controller'
import * as EncryptSubmissionController from '../../../../../../modules/submission/encrypt-submission/encrypt-submission.controller'
import { limitRate } from '../../../../../../utils/limit-rate'

export const AdminFormsPublicRouter = Router()

// All routes in this handler should be protected by authentication.
AdminFormsPublicRouter.use(authenticateApiKey)

AdminFormsPublicRouter.route('/')
  /**
   * List the forms managed by the user
   * @security bearer authentication
   *
   * @returns 200 with a list of forms managed by the user
   * @returns 401 when user is not authorised
   * @returns 422 when user of given id cannnot be found in the database
   * @returns 500 when database errors occur
   */
  .get(
    limitRate({ max: rateLimitConfig.publicApi }),
    AdminFormController.handleListDashboardForms,
  )

AdminFormsPublicRouter.route('/:formId([a-fA-F0-9]{24})')
  /**
   * Updates the form definition of a given form
   * @security bearer authentication
   *
   * @returns 200 with updated form definition
   * @returns 401 when user is not authenticated
   * @returns 404 when form cannot be found
   * @returns 404 when form field cannot be found
   * @returns 409 when form field update conflicts with database state
   * @returns 410 when updating an archived form
   * @returns 413 when updating form field causes form to be too large to be saved in the database
   * @returns 422 when an invalid form field update is attempted on the form
   * @returns 422 when user in session cannot be retrieved from the database
   * @returns 500 when database error occurs
   */
  .put(
    limitRate({ max: rateLimitConfig.publicApi }),
    AdminFormController.handleUpdateFormApi,
  )

/**
 * Count the number of submissions for a form
 * @route GET /:formId/submissions/count
 * @security bearer authentication
 *
 * @returns 200 with submission counts of given form
 * @returns 400 when query.startDate or query.endDate is malformed
 * @returns 401 when user does not exist in session
 * @returns 403 when user does not have permissions to access form
 * @returns 404 when form cannot be found
 * @returns 410 when form is archived
 * @returns 422 when user in session cannot be retrieved from the database
 * @returns 500 when database error occurs
 */
AdminFormsPublicRouter.route('/:formId([a-fA-F0-9]{24})/submissions/count').get(
  AdminFormController.handleCountFormSubmissions,
)

/**
 * Stream download all encrypted responses for a form
 * @route GET /:formId/submissions/download
 * @security bearer authentication
 *
 * @returns 200 with stream of encrypted responses
 * @returns 400 if form is not an encrypt mode form
 * @returns 400 when Joi validation fails
 * @returns 401 when user does not exist in session
 * @returns 403 when user does not have read permissions for form
 * @returns 404 when form cannot be found
 * @returns 410 when form is archived
 * @returns 422 when user in session cannot be retrieved from the database
 * @returns 500 if any errors occurs in stream pipeline or error retrieving form
 */
AdminFormsPublicRouter.route(
  '/:formId([a-fA-F0-9]{24})/submissions/download',
).get(EncryptSubmissionController.handleStreamEncryptedResponses)
