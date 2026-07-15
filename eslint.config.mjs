import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];
const jsFiles = ['**/*.{js,mjs,cjs}'];

const tsLanguageOptions = {
    parser: tsParser,
    parserOptions: {
        ecmaVersion: 'latest',
        projectService: {
            allowDefaultProject: ['*.ts'],
        },
        sourceType: 'module',
        tsconfigRootDir: import.meta.dirname,
    },
    globals: {
        ...globals.node,
        ...globals.es2023,
    },
};

const tsPresetConfigs = [
    ...tsEslint.configs['flat/strict-type-checked'],
    ...tsEslint.configs['flat/stylistic-type-checked'].slice(2),
].map((config) => ({
    ...config,
    files: config.files ?? tsFiles,
    languageOptions: {
        ...config.languageOptions,
        ...tsLanguageOptions,
        parserOptions: {
            ...config.languageOptions?.parserOptions,
            ...tsLanguageOptions.parserOptions,
        },
        globals: {
            ...config.languageOptions?.globals,
            ...tsLanguageOptions.globals,
        },
    },
}));

const testTsLanguageOptions = {
    ...tsLanguageOptions,
    parserOptions: {
        ...tsLanguageOptions.parserOptions,
        project: './tsconfig.vitest.json',
        projectService: false,
    },
};

// https://eslint.style/rules
// https://eslint.org/docs/latest/rules/
const additionalRules = {
    'block-spacing': 'error',
    'no-duplicate-imports': 'error',
    'no-inner-declarations': 'error',
    'no-template-curly-in-string': 'error',
    'no-unassigned-vars': 'error',
    'no-useless-assignment': 'error',
    'require-atomic-updates': 'error',
    'block-scoped-var': 'error',
    'camelcase': 'error',
    'complexity': 'error',
    'consistent-return': 'error',
    'curly': 'error',
    'default-case-last': 'error',
    'default-param-last': 'error',
    'dot-notation': 'error',
    'eqeqeq': 'error',
    'guard-for-in': 'error',
    'max-classes-per-file': 'error',
    'max-depth': ['error', { 'max': 2 }],
    'no-alert': 'error',
    'no-else-return': 'error',
    'no-empty': 'error',
    'no-empty-function': 'error',
    'no-eq-null': 'error',
    'no-implicit-globals': 'error',
    'no-implied-eval': 'error',
    'no-invalid-this': 'error',
    'no-labels': 'error',
    'no-lone-blocks': 'error',
    'no-multi-assign': 'error',
    'no-loop-func': 'error',
    'no-param-reassign': 'error',
    'no-return-assign': 'error',
    'no-script-url': 'error',
    'no-sequences': 'error',
    'no-shadow': 'error',
    'no-throw-literal': 'error',
    'no-undefined': 'error',
    'no-unneeded-ternary': 'error',
    'no-unused-expressions': 'error',
    'no-useless-constructor': 'error',
    'no-useless-rename': 'error',
    'no-var': 'error',
    'prefer-arrow-callback': 'error',
    'prefer-const': 'error',
    'prefer-object-has-own': 'error',
    'prefer-object-spread': 'error',
    'prefer-spread': 'error',
    'yoda': 'error',
    '@stylistic/indent': ['error', 4],
    '@stylistic/indent-binary-ops': ['error', 4],
    '@stylistic/semi': ['error', 'always'],
    '@stylistic/member-delimiter-style': ['error', {
        multiline: {
            delimiter: 'semi',
            requireLast: true,
        },
        singleline: {
            delimiter: 'semi',
            requireLast: false,
        },
    }],
    '@stylistic/quotes': ['error', 'single', {
        avoidEscape: true,
        allowTemplateLiterals: 'always',
    }]
};

export default defineConfig([
    {
        ignores: ['node_modules/**', 'dist/**', 'public/build/**', 'assets/vendor/**', 'vendor/**', 'webpack.config.cjs'],
    },
    {
        ...eslint.configs.recommended,
        files: tsFiles,
        languageOptions: tsLanguageOptions,
    },
    ...tsPresetConfigs,
    {
        ...stylistic.configs.recommended,
        files: tsFiles,
        languageOptions: tsLanguageOptions,
        plugins: {
            ...(stylistic.configs.recommended.plugins ?? {}),
            '@typescript-eslint': tsEslint,
            '@stylistic': stylistic,
        },
        rules: {
            // https://typescript-eslint.io/rules
            ...(stylistic.configs.recommended.rules ?? {}),
            '@typescript-eslint/explicit-function-return-type': 'error',
            '@typescript-eslint/explicit-member-accessibility': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/consistent-generic-constructors': 'error',
            '@typescript-eslint/consistent-indexed-object-style': ['error', 'index-signature'],
            '@typescript-eslint/array-type': ['error', {'default': 'array'}],
            '@typescript-eslint/no-extraneous-class': ['error', {
                allowStaticOnly: true,
                allowWithDecorator: true,
            }],
            ...additionalRules,
        }
    },
    {
        files: ['tests/**/*.ts'],
        languageOptions: testTsLanguageOptions,
    },
    {
        ...eslint.configs.recommended,
        ...stylistic.configs.recommended,
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2023,
            },
        },
        plugins: {
            ...(stylistic.configs.recommended.plugins ?? {}),
            '@stylistic': stylistic,
        },
        rules: {
            ...additionalRules,
        }
    },
]);
