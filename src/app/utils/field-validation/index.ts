import { Either, isLeft, left, right } from 'fp-ts/lib/Either'
import { err, ok, Result } from 'neverthrow'

import { FIELDS_TO_REJECT } from '../../../../shared/constants/field/basic'
import { BasicField, FormField, FormFieldDto } from '../../../../shared/types'
import {
  ProcessedAttachmentResponse,
  ProcessedCheckboxResponse,
  ProcessedChildrenResponse,
  ProcessedFieldResponse,
  ProcessedSingleAnswerResponse,
  ProcessedTableResponse,
} from '../../../app/modules/submission/submission.types'
import { ParsedClearFormFieldResponseV3 } from '../../../types/api/submission'
import {
  FieldValidationSchema,
  FormFieldSchema,
  ITableFieldSchema,
  OmitUnusedValidatorProps,
} from '../../../types/field'
import { ResponseValidator } from '../../../types/field/utils/validation'
import { createLoggerWithLabel } from '../../config/logger'
import { ValidateFieldError } from '../../modules/submission/submission.errors'

import {
  constructAttachmentFieldValidator,
  constructCheckboxFieldValidator,
  constructChildFieldValidator,
  constructFieldResponseValidatorV3,
  constructSingleAnswerValidator,
  constructTableFieldValidator,
} from './answerValidator.factory'
import {
  isGenericStringAnswerResponseV3,
  isProcessedAttachmentResponse,
  isProcessedCheckboxResponse,
  isProcessedChildResponse,
  isProcessedSingleAnswerResponse,
  isProcessedTableResponse,
} from './field-validation.guards'

const logger = createLoggerWithLabel(module)

/**
 * Verifies whether the response field type should be accepted
 * @param response The submitted response
 */
const isValidResponseFieldType = (response: ProcessedFieldResponse): boolean =>
  FIELDS_TO_REJECT.includes(response.fieldType) ? false : true

/**
 * Compares the response field type to the form field type
 * @param formField The form field to compare the response to
 * @param response The submitted response
 */
const doFieldTypesMatch = (
  formField: FieldValidationSchema,
  response: ProcessedFieldResponse,
): Either<string, undefined> => {
  return response.fieldType !== formField.fieldType
    ? left(
        `Response fieldType (${response.fieldType}) did not match field ${formField.fieldType}`,
      )
    : right(undefined)
}

/**
 * Returns true if response appears on a hidden field.
 * This may happen if a submission is made programatically to try and bypass form logic.
 * @param response The submitted response
 */
const isResponsePresentOnHiddenField = (
  response: ProcessedFieldResponse,
): boolean => {
  if (response.isVisible) return false
  if (isProcessedSingleAnswerResponse(response)) {
    if (response.answer.trim() !== '') {
      return true
    }
  } else if (isProcessedCheckboxResponse(response)) {
    if (response.answerArray.length > 0) {
      return true
    }
  } else if (isProcessedTableResponse(response)) {
    if (
      !response.answerArray.every((row) => row.every((elem) => elem === ''))
    ) {
      return true
    }
  } else if (isProcessedAttachmentResponse(response)) {
    if (
      (response.filename && response.filename.trim() !== '') || // filename is defined only if there is a file uploaded for the response
      response.answer.trim() !== '' ||
      response.content
    ) {
      return true
    }
  }
  return false
}

/**
 * Determines whether a response requires validation. A required field
 * may not require an answer if it is not visible due to logic. However,
 * if an answer is presented, it should be validated.
 * @param formField The form field to compare the response to
 * @param response The submitted response
 */
const singleAnswerRequiresValidation = (
  formField: FieldValidationSchema,
  response: ProcessedSingleAnswerResponse,
) => (formField.required && response.isVisible) || response.answer.trim() !== ''

const attachmentRequiresValidation = (
  formField: FieldValidationSchema,
  response: ProcessedAttachmentResponse,
) => (formField.required && response.isVisible) || response.answer.trim() !== ''

const checkboxRequiresValidation = (
  formField: FieldValidationSchema,
  response: ProcessedCheckboxResponse,
) =>
  (formField.required && response.isVisible) || response.answerArray.length > 0

const childrenRequiresValidation = (
  formField: FieldValidationSchema,
  response: ProcessedChildrenResponse,
) =>
  (formField.required && response.isVisible) ||
  response.answerArray.length > 0 ||
  (response?.childSubFieldsArray?.length ?? -1) > 0

const tableRequiresValidation = (
  formField: OmitUnusedValidatorProps<ITableFieldSchema>,
  response: ProcessedTableResponse,
) => {
  const { columns } = formField
  const { isVisible } = response
  const requiredVisible = columns.some((column) => column.required) && isVisible
  const answerPresent = !response.answerArray.every((row) =>
    row.every((elem) => elem === ''),
  )
  return requiredVisible || answerPresent
}

/**
 * Generic logging function for invalid fields.
 * Incomplete for table fields as the columnType is not logged.
 * @param formId id of form, for logging
 * @param formField A form field from the database
 * @param message Message to log
 * @throws {Error}
 */
const logInvalidAnswer = (
  formId: string,
  formField: FieldValidationSchema | FormFieldDto<FormField>,
  message: string,
) => {
  logger.error({
    message: `Invalid answer: ${message}`,
    meta: {
      action: 'InvalidAnswer',
      formId,
      fieldId: String(formField._id),
      fieldType: formField.fieldType,
    },
  })
}

/**
 * Helper function that applies validator to response,
 * logs if answer is invalid, and returns the result
 */
const validateResponseWithValidator = <T extends ProcessedFieldResponse>(
  validator: ResponseValidator<T>,
  formId: string,
  formField: FieldValidationSchema,
  response: T,
): Result<true, ValidateFieldError> => {
  const validEither = validator(response)
  if (isLeft(validEither)) {
    logInvalidAnswer(formId, formField, validEither.left)
    return err(new ValidateFieldError('Invalid answer submitted'))
  }
  return ok(true)
}

/**
 * Single exported function that abstracts away the complexities
 * of field validation.
 * @param formId id of form, for logging
 * @param formField A form field from the database
 * @param response A client-side response that is to be untrusted
 * @throws
 */
export const validateField = (
  formId: string,
  formField: FieldValidationSchema,
  response: ProcessedFieldResponse,
): Result<true, ValidateFieldError> => {
  if (!isValidResponseFieldType(response)) {
    return err(
      new ValidateFieldError(`Rejected field type "${response.fieldType}"`),
    )
  }

  const fieldTypeEither = doFieldTypesMatch(formField, response)

  if (isLeft(fieldTypeEither)) {
    return err(new ValidateFieldError(fieldTypeEither.left))
  }

  if (isResponsePresentOnHiddenField(response)) {
    return err(
      new ValidateFieldError(`Attempted to submit response on a hidden field`),
    )
  }

  if (isProcessedSingleAnswerResponse(response)) {
    if (singleAnswerRequiresValidation(formField, response)) {
      const validator = constructSingleAnswerValidator(formField)
      return validateResponseWithValidator(
        validator,
        formId,
        formField,
        response,
      )
    }
  } else if (isProcessedAttachmentResponse(response)) {
    if (attachmentRequiresValidation(formField, response)) {
      const validator = constructAttachmentFieldValidator(formField)
      return validateResponseWithValidator(
        validator,
        formId,
        formField,
        response,
      )
    }
  } else if (isProcessedCheckboxResponse(response)) {
    if (checkboxRequiresValidation(formField, response)) {
      const validator = constructCheckboxFieldValidator(formField)
      return validateResponseWithValidator(
        validator,
        formId,
        formField,
        response,
      )
    }
  } else if (isProcessedChildResponse(response)) {
    if (childrenRequiresValidation(formField, response)) {
      const validator = constructChildFieldValidator(formField)
      return validateResponseWithValidator(
        validator,
        formId,
        formField,
        response,
      )
    }
  } else if (
    isProcessedTableResponse(response) &&
    formField.fieldType === BasicField.Table
  ) {
    if (tableRequiresValidation(formField, response)) {
      const validator = constructTableFieldValidator(formField)
      return validateResponseWithValidator(
        validator,
        formId,
        formField,
        response,
      )
    }
  } else {
    logInvalidAnswer(formId, formField, 'Invalid response shape')
    return err(new ValidateFieldError('Response has invalid shape'))
  }
  return ok(true)
}

/**
 * Checks if a response is present on a field that is hidden.
 * The expected behavior is that a response should no be present on a hidden field.
 * @param response to check for
 * @param isVisible whether the field is visible
 * @returns
 */
const isResponsePresentOnHiddenFieldV3 = ({
  formField,
  response,
  isVisible,
  formId,
}: {
  formField: FormFieldSchema
  response: ParsedClearFormFieldResponseV3
  isVisible: boolean
  formId: string
}): Result<boolean, ValidateFieldError> => {
  if (isVisible) return ok(false)

  if (isGenericStringAnswerResponseV3(response)) {
    const answer = response.answer
    const isStringAnswerEmpty = answer.toString().trim() === ''
    return ok(!isStringAnswerEmpty)
  }
  switch (response.fieldType) {
    case BasicField.YesNo:
      return ok(response.answer.trim() !== '')
    case BasicField.Email:
    case BasicField.Mobile:
      return ok(
        response.answer.value.trim() !== '' ||
          response.answer.signature?.trim() !== '',
      )
    case BasicField.Radio:
      return ok(
        ('value' in response.answer && response.answer.value.trim() !== '') ||
          ('othersInput' in response.answer &&
            response.answer.othersInput.trim() !== ''),
      )
    case BasicField.Checkbox:
      return ok(response.answer.value?.length > 0)
    case BasicField.Table:
      return ok(
        !response.answer.every((rowObject) =>
          Object.values(rowObject).every((value) => value === ''),
        ),
      )
    case BasicField.Attachment:
      return ok(
        response.answer.filename.trim() !== '' || // filename is defined only if there is a file uploaded for the response
          response.answer.answer.trim() !== '' ||
          !!response.answer.content,
      )
    case BasicField.Children:
      return ok(
        (response.answer.child && response.answer.child.length > 1) ||
          (response.answer.child.length === 1 &&
            response.answer.child[0] &&
            response.answer.child[0].every((val) => val !== '')), // If only 1 element which has fields all empty, same as no child selected.
      )
  }
  logInvalidAnswer(formId, formField, 'Invalid response shape')
  return err(new ValidateFieldError('Response has invalid shape'))
}

const isValidationRequiredV3 = ({
  formField,
  response,
  isVisible,
  formId,
}: {
  formField: FormFieldSchema
  response: ParsedClearFormFieldResponseV3
  isVisible: boolean
  formId: string
}): Result<boolean, ValidateFieldError> => {
  if (isGenericStringAnswerResponseV3(response)) {
    return ok(
      (formField.required && isVisible) ||
        response.answer.toString().trim() !== '',
    )
  } else if (response.fieldType === BasicField.YesNo) {
    return ok(
      (formField.required && isVisible) || response.answer.trim() !== '',
    )
  } else if (response.fieldType === BasicField.Radio) {
    return ok(
      (formField.required && isVisible) ||
        ('value' in response.answer && response.answer.value.trim() !== '') ||
        ('othersInput' in response.answer &&
          response.answer.othersInput.trim() !== ''),
    )
  } else if (response.fieldType === BasicField.Checkbox) {
    return (
      ok(formField.required && isVisible) || response.answer.value.length > 0
    )
  } else if (
    response.fieldType === BasicField.Table &&
    formField.fieldType === BasicField.Table
  ) {
    const { columns } = formField
    const isRequiredColumnsVisible =
      columns.some((column) => column.required) && isVisible
    const isAnswerPresent = !response.answer.every((row) =>
      Object.values(row).every((value) => value === ''),
    )
    return ok(isRequiredColumnsVisible || isAnswerPresent)
  } else if (response.fieldType === BasicField.Attachment) {
    return ok(
      (formField.required && isVisible) ||
        (response.answer &&
          response.answer.content &&
          response.answer.filename.trim() !== ''),
    )
  } else if (response.fieldType === BasicField.Children) {
    return ok(
      (formField.required && isVisible) ||
        response.answer.child.length > 0 ||
        response.answer.childFields.length > 0,
    )
  }
  logInvalidAnswer(formId, formField, 'Invalid response shape')
  return err(new ValidateFieldError('Response has invalid shape'))
}

const validateResponseWithValidatorV3 = <
  T extends ParsedClearFormFieldResponseV3,
>(
  validator: ResponseValidator<T>,
  formId: string,
  formField: FormFieldSchema,
  response: T,
): Result<true, ValidateFieldError> => {
  const validEither = validator(response)
  if (isLeft(validEither)) {
    logInvalidAnswer(formId, formField, validEither.left)
    return err(new ValidateFieldError('Invalid answer submitted'))
  }
  return ok(true)
}

export const validateFieldV3 = ({
  formId,
  formField,
  response,
  isVisible,
}: {
  formId: string
  formField: FormFieldSchema
  response: ParsedClearFormFieldResponseV3
  isVisible: boolean
}): Result<true, ValidateFieldError> => {
  const isFieldTypeSubmitExpected = !FIELDS_TO_REJECT.includes(
    response.fieldType,
  )
  if (!isFieldTypeSubmitExpected) {
    return err(
      new ValidateFieldError(`Rejected field type "${response.fieldType}"`),
    )
  }

  const isFieldTypeMatching = formField.fieldType === response.fieldType
  if (!isFieldTypeMatching) {
    return err(
      new ValidateFieldError(
        `Response fieldType (${response.fieldType}) did not match field ${formField.fieldType}`,
      ),
    )
  }

  const isResponsePresentOnHiddenFieldV3Result =
    isResponsePresentOnHiddenFieldV3({ formField, response, isVisible, formId })

  if (isResponsePresentOnHiddenFieldV3Result.isErr()) {
    return err(isResponsePresentOnHiddenFieldV3Result.error)
  }

  if (isResponsePresentOnHiddenFieldV3Result.value) {
    return err(
      new ValidateFieldError(`Attempted to submit response on a hidden field`),
    )
  }

  const isValidationRequiredV3Result = isValidationRequiredV3({
    formField,
    response,
    isVisible,
    formId,
  })

  if (isValidationRequiredV3Result.isErr()) {
    return err(isValidationRequiredV3Result.error)
  }

  if (!isValidationRequiredV3Result.value) {
    return ok(true)
  }

  const validator = constructFieldResponseValidatorV3({
    formId,
    formField,
    isVisible,
  })
  return validateResponseWithValidatorV3(validator, formId, formField, response)
}
