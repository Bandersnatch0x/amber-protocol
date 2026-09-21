import fs from 'fs';
import path from 'path';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

// Load version & environment assumptions directly from repository release metadata
const rootPkgPath = path.resolve(__dirname, '../../package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

const amberVersion = rootPkg.version || '1.6.0';
const nodeEngines = rootPkg.engines?.node || '^20.19.0 || ^22.12.0 || >=23';

const config: Config = {
  title: 'Amber Protocol',
  tagline: 'Repository-local governance kit for agent-assisted engineering',
  favicon: 'img/amber-logo.svg',

  url: 'https://bandersnatch0x.github.io',
  baseUrl: process.env.DOCUSAURUS_BASE_URL || '/amber-protocol/',

  organizationName: 'Bandersnatch0x',
  projectName: 'amber-protocol',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  customFields: {
    amberVersion,
    nodeEngines,
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/Bandersnatch0x/amber-protocol/tree/master/apps/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['en'],
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/',
      },
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Amber Protocol',
      logo: {
        alt: 'Amber Logo',
        src: 'img/amber-logo.svg',
        srcDark: 'img/amber-logo.svg',
        width: 32,
        height: 32,
      },
      items: [
        {
          to: '/start-here',
          label: 'Start Here',
          position: 'left',
        },
        {
          to: '/concepts',
          label: 'Concepts',
          position: 'left',
        },
        {
          to: '/guides',
          label: 'Guides',
          position: 'left',
        },
        {
          to: '/reference',
          label: 'Reference',
          position: 'left',
        },
        {
          to: '/troubleshooting',
          label: 'Troubleshooting',
          position: 'left',
        },
        {
          to: '/about',
          label: 'About',
          position: 'left',
        },
        {
          href: 'https://github.com/Bandersnatch0x/amber-protocol',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Reader Journey',
          items: [
            {
              label: 'Start Here',
              to: '/start-here',
            },
            {
              label: 'Installation',
              to: '/start-here/installation',
            },
            {
              label: 'First Governed Workflow',
              to: '/start-here/first-governed-workflow',
            },
          ],
        },
        {
          title: 'Architecture & Guides',
          items: [
            {
              label: 'Core Concepts',
              to: '/concepts',
            },
            {
              label: 'Adopting Existing Projects',
              to: '/guides/adopting-existing-project',
            },
            {
              label: 'Session Handoffs',
              to: '/guides/session-handoff',
            },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'CLI Commands (54)',
              to: '/reference/cli',
            },
            {
              label: 'Schemas',
              to: '/reference/schemas',
            },
            {
              label: 'Action Types',
              to: '/reference/action-types',
            },
          ],
        },
        {
          title: 'Governance & Safety',
          items: [
            {
              label: 'Troubleshooting',
              to: '/troubleshooting',
            },
            {
              label: 'Safety Boundaries',
              to: '/about/boundaries',
            },
            {
              label: 'Contributing',
              to: '/about/contributing',
            },
          ],
        },
        {
          title: 'Release & Provenance',
          items: [
            {
              label: 'GitHub Repository',
              href: 'https://github.com/Bandersnatch0x/amber-protocol',
            },
            {
              label: `Version v${amberVersion}`,
              to: '/about/version-history',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Amber Protocol. Repository-local governance. Zero external telemetry.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
