import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'
// Đặt CUỐI cùng: tắt mọi rule format của ESLint, nhường hết cho Prettier.
import prettierConfig from 'eslint-config-prettier/flat'

export default tseslint.config(
  // Không lint output build / thư viện. `dist-ssr`, `.vite` là cache của Vite.
  { ignores: ['dist/**', 'dist-ssr/**', 'node_modules/**', '.vite/**', 'public/**'] },

  // ---- Nguồn ứng dụng (chạy trên browser) ----
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // HMR chỉ hoạt động khi file component export duy nhất component.
      // Cho phép export hằng số kèm theo (variants của cva, constants...).
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // tsconfig đã bật noUnusedLocals/noUnusedParameters nên `tsc --noEmit` mới là
      // nguồn sự thật. Ở đây để 'warn' + cho phép prefix `_` để bỏ qua có chủ đích.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // `any` là phương án cuối (xem .claude/rules/typescript.md) — cảnh báo chứ
      // không chặn build, để không cản việc đang làm dở.
      '@typescript-eslint/no-explicit-any': 'warn',

      // tsconfig bật verbatimModuleSyntax: import type PHẢI tường minh, nếu không
      // import sẽ bị giữ lại lúc runtime. Rule này autofix được bằng `lint:fix`.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Cho phép `console.warn/error` (dùng cho telemetry), cảnh báo `console.log` sót lại.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // --- react-hooks v7 (rule kiểu React Compiler) ---
      // Giữ 'warn' thay vì 'error': đây là gợi ý theo hướng dẫn mới của React, vi phạm
      // còn lại đều đã rà tay và là cố ý (xem eslint-disable kèm lý do tại chỗ).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',

      // Dự án KHÔNG bật React Compiler (vite chỉ dùng @vitejs/plugin-react, không có
      // babel-plugin-react-compiler). Rule này chỉ cảnh báo compiler sẽ bỏ qua việc
      // memo hóa component dùng `form.watch()` của react-hook-form — vô nghĩa khi
      // chưa có compiler. Bật lại nếu sau này dùng React Compiler.
      'react-hooks/incompatible-library': 'off',
    },
  },

  // ---- File shadcn/ui sinh ra sẵn ----
  // Theo .claude/rules/components.md: coi như file generated, không sửa tay. Chúng
  // luôn export thêm hằng/biến thể cạnh component nên luôn vướng rule HMR này.
  {
    files: ['src/shared/ui/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // ---- Logger ----
  // Chỗ DUY NHẤT được phép gọi console: đây chính là lớp bọc log của dự án.
  {
    files: ['src/core/telemetry/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  // ---- File cấu hình chạy trên Node ----
  {
    files: ['*.{js,ts}', 'vite.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  prettierConfig,
)
