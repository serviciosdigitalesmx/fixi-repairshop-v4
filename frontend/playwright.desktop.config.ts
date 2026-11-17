import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const root = process.env.FIXI_QA_RUN ?? 'D:/QA/fixi-web-20261117/runtime/manual'
export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(root, 'raw-results'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(root, 'raw-report'), open: 'never' }],
    ['json', { outputFile: path.join(root, 'raw-report.json') }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:15173',
    viewport: { width: 1280, height: 640 },
    headless: false,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'retain-on-failure',
    video: 'on',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
  },
  projects: [{ name: 'desktop-visible' }],
})
