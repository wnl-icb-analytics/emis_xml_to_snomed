import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // Existing copy and hydration patterns; not worth rewriting for first CI.
      'react/no-unescaped-entities': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'debug-report.js',
    'scripts/**',
    'SnomedCT_UKPrimaryCareRF2_PRODUCTION_20251211T000000Z/**',
  ]),
])

export default eslintConfig

