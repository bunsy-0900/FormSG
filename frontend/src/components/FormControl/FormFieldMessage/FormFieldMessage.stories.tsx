import { FormControl } from '@chakra-ui/form-control'
import { Meta, StoryFn } from '@storybook/react'

import { FormFieldMessage, FormFieldMessageProps } from './FormFieldMessage'

export default {
  title: 'Components/FormControl/FormFieldMessage',
  component: FormFieldMessage,
  decorators: [],
} as Meta

const Template: StoryFn<FormFieldMessageProps> = ({ children, ...args }) => (
  // FormControl component required to pass appropriate props into component.
  <FormControl>
    <FormFieldMessage {...args}>{children}</FormFieldMessage>
  </FormControl>
)

export const Info = Template.bind({})
Info.args = {
  children: 'Date of birth should be in DD/MM/YYYY format.',
  variant: 'info',
}

export const Success = Template.bind({})
Success.args = {
  children: 'This is a success message.',
  variant: 'success',
}
