import type { StorybookConfig } from '@storybook/react/types';

const config: StorybookConfig = {
  stories: [
    {
      directory: '../src',
      titlePrefix: 'Demo',
    },
  ],
  logLevel: 'debug',
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-storysource',
    '@storybook/addon-storyshots',
    '@storybook/addon-a11y',
  ],
  typescript: {
    check: true,
    checkOptions: {},
    reactDocgenTypescriptOptions: {
      propFilter: (prop) => ['label', 'disabled'].includes(prop.name),
    },
  },
  core: {
    builder: { name: '@storybook/builder-webpack5' },
    channelOptions: { allowFunction: false, maxDepth: 10 },
  },
  features: {
    postcss: false,
    modernInlineRender: true,
    storyStoreV7: !global.navigator?.userAgent?.match?.('jsdom'),
    buildStoriesJson: true,
    babelModeV7: true,
    warnOnLegacyHierarchySeparator: false,
    previewMdx2: true,
    breakingChangesV7: true,
  },
  framework: '@storybook/react',
};
module.exports = config;
