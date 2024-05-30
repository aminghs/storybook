import { expect, mocked, getByRole, spyOn, userEvent } from '@storybook/test';

const meta = {
  component: globalThis.Components.Button,
  loaders() {
    spyOn(console, 'log').mockName('console.log');
    console.log('1 - [from loaders]');
  },
  beforeEach() {
    console.log('2 - [from meta beforeEach]');
  },
};

export default meta;

export const MountInPlay = {
  parameters: {
    chromatic: { disable: true },
  },
  beforeEach() {
    console.log('3 - [from story beforeEach]');
  },
  decorators: (storyFn) => {
    console.log('5 - [from decorator]');
    return storyFn();
  },
  args: {
    label: 'Button',
    onClick: () => {
      console.log('7 - [from onClick]');
    },
  },
  async play({ mount, canvasElement }) {
    console.log('4 - [before mount]');
    await mount();
    console.log('6 - [after mount]');
    await userEvent.click(getByRole(canvasElement, 'button'));
    await expect(mocked(console.log).mock.calls).toEqual([
      ['1 - [from loaders]'],
      ['2 - [from meta beforeEach]'],
      ['3 - [from story beforeEach]'],
      ['4 - [before mount]'],
      ['5 - [from decorator]'],
      ['6 - [after mount]'],
      ['7 - [from onClick]'],
    ]);
  },
};
