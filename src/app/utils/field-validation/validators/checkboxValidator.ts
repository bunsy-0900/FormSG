import { chain, left, right } from 'fp-ts/lib/Either'
import { flow } from 'fp-ts/lib/function'

import { BasicField, CheckboxResponseV3 } from '../../../../../shared/types'
import { ParsedClearFormFieldResponseV3 } from '../../../../types/api'
import {
  ICheckboxFieldSchema,
  OmitUnusedValidatorProps,
} from '../../../../types/field'
import {
  ResponseValidator,
  ResponseValidatorConstructor,
} from '../../../../types/field/utils/validation'
import { ProcessedCheckboxResponse } from '../../../modules/submission/submission.types'

import { isOtherOption } from './options'

type CheckboxValidator = ResponseValidator<ProcessedCheckboxResponse>
type CheckboxValidatorConstructor = (
  checkboxField: OmitUnusedValidatorProps<ICheckboxFieldSchema>,
) => CheckboxValidator

/**
 * Returns a validator to check if answerArray is empty
 */
const checkboxAnswerValidator: CheckboxValidator = (response) => {
  const { answerArray } = response

  return answerArray.length === 0
    ? left(`CheckboxValidator:\t Answer is empty array`)
    : right(response)
}

/**
 * Returns a validation function to check if number of
 * selected checkbox options is less than the minimum number specified.
 */
const minOptionsValidator: CheckboxValidatorConstructor =
  (checkboxField) => (response) => {
    const { validateByValue } = checkboxField
    const { customMin } = checkboxField.ValidationOptions
    const { answerArray } = response

    if (!validateByValue || !customMin) return right(response)

    return answerArray.length >= customMin
      ? right(response)
      : left(
          `CheckboxValidator:\t answer has less options selected than minimum specified`,
        )
  }

/**
 * Returns a validation function to check if number of
 * selected checkbox options is more than the maximum number specified.
 */
const maxOptionsValidator: CheckboxValidatorConstructor =
  (checkboxField) => (response) => {
    const { validateByValue } = checkboxField
    const { customMax } = checkboxField.ValidationOptions
    const { answerArray } = response

    if (!validateByValue || !customMax) return right(response)

    return answerArray.length <= customMax
      ? right(response)
      : left(
          `CheckboxValidator:\t answer has more options selected than maximum specified`,
        )
  }

// The overall logic for the following three validators is as follows:
// We split the answers into:
// 1. Those beginning with "Others: "
// 2. Those not beginning with "Others: ".
// For group 1, we allow at most 1 answer which is not one of the `fieldOptions` if `othersRadioButton` is true, and 0 otherwise.
// Amongst the answers in the `fieldOptions`, there can be no duplicates.
// For group 2, there can be no duplicates.

/**
 * Returns a validation function to check if the
 * answers are all either within the specified field options or
 * have the correct format for 'others' answer, if others is enabled.
 * The logic is that there are two types of answers: those starting with "Others: " and those which do not.
 * For those which do not start with "Others: ", they must be one of the fieldOptions since they cannot possibly be an "Others" option.
 * For those which start with "Others: ", they must also be one of the fieldOptions unless othersRadioButton is enabled.
 */
const validOptionsValidator: CheckboxValidatorConstructor =
  (checkboxField) => (response) => {
    const { fieldOptions, othersRadioButton } = checkboxField
    const { answerArray } = response

    return answerArray.every(
      (answer) =>
        fieldOptions.includes(answer) ||
        isOtherOption(othersRadioButton, answer),
    )
      ? right(response)
      : left(`CheckboxValidator:\t answer is not valid`)
  }

/**
 * Returns a validation function to check if there are any
 * duplicates amongst the non-others answers.
 * This includes answers which do not start with the string "Others: ",
 * as well as answers which start with the string "Others: " but othersRadioButton is not enabled.
 * We had already checked if all of them are one of the fieldOptions. Since fieldOptions are distinct,
 * there should be no duplicates amongst the non-others answers.
 */
const duplicateNonOtherOptionsValidator: CheckboxValidatorConstructor =
  (checkboxField) => (response) => {
    const { othersRadioButton } = checkboxField
    const { answerArray } = response

    const nonOtherAnswers = answerArray.filter(
      (answer) => !isOtherOption(othersRadioButton, answer),
    )

    return nonOtherAnswers.length === new Set(nonOtherAnswers).size
      ? right(response)
      : left(`CheckboxValidator:\t duplicate non-other answers in response`)
  }

/**
 * Returns a validation function to check if there are any
 * duplicates amongst the others answers, or if there are more
 * than one others answer.
 * At this stage, all the remaining answers start with the string "Others: " and othersRadioButton must be enabled.
 * Note that it is possible for Admins to create fieldOptions that
 * look like ['Option 1', 'Others: please elaborate'].
 */
const duplicateOtherOptionsValidator: CheckboxValidatorConstructor =
  (checkboxField) => (response) => {
    const { fieldOptions, othersRadioButton } = checkboxField
    const { answerArray } = response

    const otherAnswers = answerArray.filter((answer) =>
      isOtherOption(othersRadioButton, answer),
    )

    // First check the answers which do not appear in fieldOptions.
    // There should be at most one.

    const otherAnswersNotInFieldOptions = otherAnswers.filter(
      (answer) => !fieldOptions.includes(answer),
    )

    if (otherAnswersNotInFieldOptions.length > 1) {
      return left(`CheckboxValidator:\t duplicate other answers in response`)
    }

    // Next check that for the remaining answers which do appear in fieldOptions,
    // Either there should no duplicates, OR
    // There should be at most 1 duplicate and otherAnswersNotInFieldOptions.length === 0
    // i.e. the 'Others' field is used for the duplicate response.

    const otherAnswersInFieldOptions = otherAnswers.filter((answer) =>
      fieldOptions.includes(answer),
    )

    const numDuplicates =
      otherAnswersInFieldOptions.length -
      new Set(otherAnswersInFieldOptions).size

    if (numDuplicates > 1) {
      return left(`CheckboxValidator:\t duplicate other answers in response`)
    } else if (numDuplicates === 1 && otherAnswersInFieldOptions.length !== 0) {
      return left(`CheckboxValidator:\t duplicate other answers in response`)
    } else {
      return right(response)
    }
  }

/**
 * Returns a validation function for a checkbox field when called.
 */
export const constructCheckboxValidator: CheckboxValidatorConstructor = (
  checkboxField,
) =>
  flow(
    checkboxAnswerValidator,
    chain(minOptionsValidator(checkboxField)),
    chain(maxOptionsValidator(checkboxField)),
    chain(validOptionsValidator(checkboxField)),
    chain(duplicateNonOtherOptionsValidator(checkboxField)),
    chain(duplicateOtherOptionsValidator(checkboxField)),
  )

const isCheckboxFieldTypeV3: ResponseValidator<
  ParsedClearFormFieldResponseV3,
  CheckboxResponseV3
> = (response) => {
  if (response.fieldType !== BasicField.Checkbox) {
    return left(
      'CheckboxValidatorV3.fieldTypeMismatch:\tfield type is not checkbox',
    )
  }
  return right(response)
}

/**
 * Checks if the checkbox has no answers selected.
 */
const isCheckboxAnswerEmptyV3: ResponseValidator<CheckboxResponseV3> = (
  response,
) => {
  const { answer } = response

  return answer.value.length === 0 && !answer.othersInput
    ? left(`CheckboxValidatorV3:\t Answer is empty`)
    : right(response)
}

/**
 * Returns a validation function to check if number of
 * selected checkbox options is less than the minimum number specified.
 */
const makeMinOptionsValidatorV3: ResponseValidatorConstructor<
  OmitUnusedValidatorProps<ICheckboxFieldSchema>,
  CheckboxResponseV3
> = (checkboxField) => (response) => {
  const { validateByValue } = checkboxField
  const { customMin } = checkboxField.ValidationOptions
  const { answer } = response

  if (!validateByValue || !customMin) return right(response)

  const numSelected = answer.value.length + (answer.othersInput ? 1 : 0)

  return numSelected >= customMin
    ? right(response)
    : left(
        `CheckboxValidatorV3:\t answer has less options selected than minimum specified`,
      )
}

/**
 * Returns a validation function to check if number of
 * selected checkbox options is more than the maximum number specified.
 */
const makeMaxOptionsValidatorV3: ResponseValidatorConstructor<
  OmitUnusedValidatorProps<ICheckboxFieldSchema>,
  CheckboxResponseV3
> = (checkboxField) => (response) => {
  const { validateByValue } = checkboxField
  const { customMax } = checkboxField.ValidationOptions
  const { answer } = response

  if (!validateByValue || !customMax) return right(response)

  const numSelected = answer.value.length + (answer.othersInput ? 1 : 0)

  return numSelected <= customMax
    ? right(response)
    : left(
        `CheckboxValidatorV3:\t answer has more options selected than maximum specified`,
      )
}

/**
 * Returns a validation function to check if the
 * answers are all either within the specified field options or
 * have the correct format for 'others' answer, if others is enabled.
 * The logic is that there are two types of answers: those starting with "Others: " and those which do not.
 * For those which do not start with "Others: ", they must be one of the fieldOptions since they cannot possibly be an "Others" option.
 * For those which start with "Others: ", they must also be one of the fieldOptions unless othersRadioButton is enabled.
 */
const makeValidOptionsValidatorV3: ResponseValidatorConstructor<
  OmitUnusedValidatorProps<ICheckboxFieldSchema>,
  CheckboxResponseV3
> = (checkboxField) => (response) => {
  const { fieldOptions, othersRadioButton } = checkboxField
  const { answer } = response

  const CHECKBOX_OTHERS_INPUT_VALUE =
    '!!FORMSG_INTERNAL_CHECKBOX_OTHERS_VALUE!!'

  return answer.value.every(
    (selectedOption) =>
      fieldOptions.includes(selectedOption) ||
      (selectedOption === CHECKBOX_OTHERS_INPUT_VALUE &&
        othersRadioButton &&
        answer.othersInput),
  ) &&
    (!answer.othersInput || (answer.othersInput && othersRadioButton))
    ? right(response)
    : left(`CheckboxValidator:\t answer is not valid`)
}

/**
 * Returns a validation function to check if there are any
 * duplicates amongst the answers.
 * Note: if admin creates fieldOptions that look like ['Option 1', 'Others: A'] and the respondent adds a new 'A' othersInput, the validation will fail.
 */
const isDuplicateSelectedOptionsPresent: ResponseValidator<
  CheckboxResponseV3
> = (response) => {
  const { answer } = response

  const selectedOptions = [...answer.value]
  if (answer.othersInput) {
    // Why: Since 'Others: ' is prepended to the othersInput value in the frontend. To match response V1 and V2 behaviour.
    selectedOptions.push(`Others: ${answer.othersInput}`)
  }

  return selectedOptions.length === new Set(selectedOptions).size
    ? right(response)
    : left(`CheckboxValidatorV3:\t duplicate answers in response`)
}

export const constructCheckboxValidatorV3: ResponseValidatorConstructor<
  OmitUnusedValidatorProps<ICheckboxFieldSchema>,
  ParsedClearFormFieldResponseV3,
  CheckboxResponseV3
> = (checkboxField) =>
  flow(
    isCheckboxFieldTypeV3,
    chain(isCheckboxAnswerEmptyV3),
    chain(makeMinOptionsValidatorV3(checkboxField)),
    chain(makeMaxOptionsValidatorV3(checkboxField)),
    chain(makeValidOptionsValidatorV3(checkboxField)),
    chain(isDuplicateSelectedOptionsPresent),
  )
