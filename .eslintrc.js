module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // 错误级别
    'no-console': 'off', // 允许 console
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'no-undef': 'error',
    'no-empty': ['error', { allowEmptyCatch: true }], // 允许空 catch 块

    // 代码风格
    'indent': ['warn', 2, { SwitchCase: 1 }],
    'quotes': ['warn', 'single', { avoidEscape: true }],
    'semi': ['warn', 'always'],
    'comma-dangle': ['warn', 'never'],
    'no-trailing-spaces': 'warn',
    'eol-last': ['warn', 'always'],

    // 最佳实践
    'no-var': 'warn',
    'prefer-const': 'warn',
    'no-multiple-empty-lines': ['warn', { max: 2 }],
    'no-multi-spaces': 'warn',
    'no-constant-condition': ['error', { checkLoops: false }] // 允许 while(true)
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'public/',
    'coverage/',
    '*.min.js'
  ]
};
