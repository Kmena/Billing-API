module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin', 'import'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist/', 'node_modules/'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'error',
    // Prohibit @prisma/client imports in domain layer
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@prisma/client'],
            message:
              'Prisma client must not be imported in domain layer. Use output ports (repository interfaces) instead.',
          },
        ],
      },
    ],
    'import/no-cycle': 'error',
  },
  overrides: [
    {
      // Allow prisma imports ONLY outside the domain layer — also in tests and prisma scripts
      files: [
        'src/infrastructure/**/*.ts',
        'src/modules/*/infrastructure/**/*.ts',
        'prisma/**/*.ts',
        'test/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    {
      // Domain files must NOT import prisma, nestjs framework, or infra libs
      files: ['src/modules/*/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@prisma/client', '@nestjs/*', 'pg-boss', 'axios'],
                message:
                  'Domain layer must be framework-agnostic. Do not import infrastructure or framework dependencies.',
              },
            ],
          },
        ],
      },
    },
  ],
};
